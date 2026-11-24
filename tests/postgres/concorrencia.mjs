import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'

const [manifest, database, port, username] = process.argv.slice(2)
if (!manifest || !/^mr_saloum_concorrencia_[a-z0-9_]+$/.test(database ?? '') ||
    !/^\d{4,5}$/.test(port ?? '') || Number(port) > 65535 || !username) {
  throw new Error('Uso: node tests/postgres/concorrencia.mjs fixtures.local.json mr_saloum_concorrencia_teste 55432 usuario_local')
}

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)))
if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD
env.PGCONNECT_TIMEOUT = '3'
env.PGOPTIONS = '-c statement_timeout=15000 -c lock_timeout=8000'
const args = ['-X', '-w', '-qAt', '-h', '127.0.0.1', '-p', port, '-U', username, '-d', database, '-v', 'ON_ERROR_STOP=1']
const quote = (value) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
const uuid = (value) => {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value ?? '')) throw new Error('UUID sintético inválido')
  return `${quote(value)}::uuid`
}
const root = dirname(resolve(manifest))
const fixtures = JSON.parse(readFileSync(manifest, 'utf8'))
const barrier = 386052114 + process.pid
const prefix = `saloum_homolog_${process.pid}`

function psql(input, extra = []) {
  const result = spawnSync('psql', [...args, ...extra], { env, input, encoding: 'utf8', timeout: 18000 })
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim())
  return result.stdout.trim()
}

const marker = psql("SELECT current_database() || ':' || marker FROM public.homologacao_descartavel;")
if (marker !== `${database}:MR_SALOUM_SINTETICO`) throw new Error('Marcador de banco descartável ausente ou inválido')

function session(label) {
  const name = `${prefix}_${label}`
  const child = spawn('psql', args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] })
  const output = []
  let errors = ''
  let ended = false
  createInterface({ input: child.stdout }).on('line', (line) => output.push(line))
  child.stderr.on('data', (chunk) => { errors += chunk })
  child.on('error', (error) => { errors += error.message; ended = true })
  child.on('close', () => { ended = true })
  child.stdin.on('error', (error) => { errors += error.message })
  return {
    name,
    send: (input) => child.stdin.write(input + '\n'),
    has: (prefix) => output.some((line) => line.startsWith(prefix)),
    async read(prefix) {
      for (let attempt = 0; attempt < 180; attempt++) {
        const line = output.find((item) => item.startsWith(prefix))
        if (line) return line.slice(prefix.length).trim()
        if (ended) throw new Error(`${name} encerrou antes de ${prefix}: ${errors}`)
        await delay(100)
      }
      throw new Error(`Tempo excedido em ${name} aguardando ${prefix}: ${errors}`)
    },
    close() { if (!ended) child.kill() }
  }
}

function commands(f) {
  const date = `${quote(f.date)}::date`
  const time = quote(f.time)
  const book = (serviceIds = [f.service]) => `SELECT public.criar_agendamento(p_barber_id => ${uuid(f.barber)}, p_data => ${date}, p_horario => ${time}, p_service_ids => ARRAY[${serviceIds.map(uuid).join(', ')}]);`
  const modify = (kind, action, id, version, values = null) =>
    `SELECT public.mr_saloum_alterar_catalogo_v1(${quote(kind)}, ${quote(action)}, ${id == null ? 'NULL::uuid' : uuid(id)}, ${quote(version)}, ${values == null ? 'NULL' : quote(JSON.stringify(values))}::jsonb);`
  const createBarber = modify('barber', 'create', null, null, { name: 'Barbeiro sintético convertido', profile_id: f.customer })
  const deactivateBarber = modify('barber', 'deactivate', f.barber, f.barberVersion)
  return {
    conversao: [[f.customer, book()], [f.admin, createBarber]],
    desativa_barbeiro: [[f.customer, book()], [f.admin, deactivateBarber]],
    desativa_servico: [[f.customer, book()], [f.admin, modify('service', 'deactivate', f.service, f.serviceVersion)]],
    mesmo_horario: [[f.customer, book([f.service, f.secondService])], [f.secondCustomer, book([f.secondService, f.service])]],
    mesma_versao: [
      [f.admin, modify('service', 'update', f.service, f.serviceVersion, f.serviceEditA)],
      [f.admin, modify('service', 'update', f.service, f.serviceVersion, f.serviceEditB)]
    ],
    perfil_desativa: [
      [f.barberUser, `SELECT public.mr_saloum_atualizar_perfil_barbeiro_v1(${uuid(f.barber)}, ${quote(f.profileVersion)}, 'https://example.test/foto.png', NULL);`],
      [f.admin, deactivateBarber]
    ],
    bloqueio_desativa: [
      [f.barberUser, `SELECT public.admin_alternar_bloqueio(p_barber_id => ${uuid(f.barber)}, p_data => ${date}, p_horario => ${time}, p_bloquear => true);`],
      [f.admin, deactivateBarber]
    ]
  }
}

function start(s, [actor, sql], gated = false) {
  s.send(`BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', ${uuid(actor)}::text, true);
SELECT set_config('request.jwt.claims', ${quote(JSON.stringify({ sub: actor, role: 'authenticated' }))}, true);
${gated ? `SELECT pg_advisory_xact_lock_shared(${barrier}::bigint);` : ''}
\\set ON_ERROR_STOP off
${sql}
\\echo OP :SQLSTATE`)
}

async function finish(s) {
  const operation = await s.read('OP ')
  s.send(`${operation === '00000' ? 'COMMIT' : 'ROLLBACK'};
\\echo TX :SQLSTATE`)
  const transaction = await s.read('TX ')
  return transaction === '00000' ? operation : transaction
}

async function blocked(s, by, ready = () => false) {
  for (let attempt = 0; attempt < 35; attempt++) {
    const yes = psql(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity waiter JOIN pg_stat_activity holder ON holder.pid = ANY(pg_blocking_pids(waiter.pid)) WHERE waiter.application_name = ${quote(s.name)} AND holder.application_name = ${quote(by.name)});`)
    if (yes === 't') return true
    if (ready()) return false
    await delay(100)
  }
  return false
}

async function run(name, entry, mode) {
  const file = (key) => resolve(root, entry[key][mode] ?? entry[key].default)
  psql(undefined, ['-f', file('setup')])
  const expected = entry.expected[mode]
  if (!Array.isArray(expected) || !expected.length) throw new Error(`Resultados esperados ausentes para ${name}/${mode}`)
  const [left, right] = commands(entry.input[mode] ?? entry.input.default)[name]
  const a = session(`${name}_${mode}_a`)
  const b = session(`${name}_${mode}_b`)
  const gate = session(`${name}_${mode}_gate`)
  let observed = false
  try {
    let result
    if (mode === 'junto') {
      gate.send(`SELECT pg_advisory_lock(${barrier}::bigint);\n\\echo READY`)
      await gate.read('READY')
      start(a, left, true)
      start(b, right, true)
      if (!(await blocked(a, gate)) || !(await blocked(b, gate))) throw new Error('Barreira de partida não observada')
      gate.send(`SELECT pg_advisory_unlock(${barrier}::bigint);`)
      result = await Promise.all([finish(a), finish(b)])
    } else {
      const [first, second, initial, next] = mode === 'a' ? [a, b, left, right] : [b, a, right, left]
      start(first, initial)
      await first.read('OP ')
      start(second, next)
      observed = await blocked(second, first, () => second.has('OP '))
      if (observed) {
        const locks = psql(`SELECT right(s.application_name, 1), l.locktype, COALESCE(l.relation::regclass::text, '-'), l.mode, l.granted
FROM pg_locks l JOIN pg_stat_activity s USING (pid)
WHERE s.application_name IN (${quote(a.name)}, ${quote(b.name)}) ORDER BY 1, 2, 3, 4, 5;`)
        console.log(`${name}/${mode} · locks (sessão|tipo|relação|modo|concedido)\n${locks}`)
      }
      const firstResult = await finish(first)
      const other = await finish(second)
      result = mode === 'a' ? [firstResult, other] : [other, firstResult]
    }
    if (result.some((code) => ['40P01', '55P03', '57014'].includes(code)) ||
        !expected.some((pair) => pair[0] === result[0] && pair[1] === result[1])) {
      throw new Error(`${name}/${mode}: SQLSTATE inesperado [${result.join(', ')}]`)
    }
    if (entry.mustBlock?.includes(mode) && !observed) throw new Error(`${name}/${mode}: bloqueio esperado não observado`)
    if (psql(undefined, ['-v', `mode=${mode}`, '-v', `state_a=${result[0]}`, '-v', `state_b=${result[1]}`, '-f', file('verify')]) !== 't') {
      throw new Error(`${name}/${mode}: verificação dos dados persistidos falhou`)
    }
    console.log(`${name}/${mode}: ${result.join('/')} · espera ${mode === 'junto' ? 'sincronizada' : observed ? 'observada' : 'não observada'}`)
  } finally {
    a.close()
    b.close()
    gate.close()
  }
}

for (const name of ['conversao', 'desativa_barbeiro', 'desativa_servico', 'mesmo_horario', 'mesma_versao', 'perfil_desativa', 'bloqueio_desativa']) {
  if (!fixtures[name]) throw new Error(`Fixture ausente: ${name}`)
  for (const mode of ['a', 'b', 'junto']) await run(name, fixtures[name], mode)
}
