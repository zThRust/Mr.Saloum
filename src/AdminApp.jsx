import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import MobileBarberCalendar from './MobileBarberCalendar'
import AdminNavigation from './AdminNavigation'
import { adminSections } from './adminSections'
import { editableBarberProfiles } from './barberProfile'
import { appointmentSwipeAction, historicalBarbers } from './barberCalendarNavigation'
import { calcularDuracaoSlots, SERVICE_SOBRANCELHA_ID } from './bookingValues'
import { useUpdateBlock } from './pwaUpdate'
const CatalogManagement = lazy(() => import('./CatalogManagement'))
const BarberProfileEditor = lazy(() => import('./BarberProfileEditor'))

// ======================================================
// PAINEL ADMINISTRATIVO
// ======================================================

export default function AdminPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [profile, setProfile] = useState(null)
  const [section, setSection] = useState('agenda')
  const [catalogAccess, setCatalogAccess] = useState({ userId: null, allowed: false })
  const [teamProfiles, setTeamProfiles] = useState({ userId: null, records: [] })
  const [contactTarget, setContactTarget] = useState('')
  const [mobileBarberId, setMobileBarberId] = useState('')
  const [financeDate, setFinanceDate] = useState('')
  const canManageCatalog = Boolean(profile?.role === 'admin' && catalogAccess.userId === profile.userId && catalogAccess.allowed)
  const editableTeam = teamProfiles.userId === profile?.userId ? teamProfiles.records : []
  const sections = adminSections({ role: profile?.role, catalog: canManageCatalog, editableProfiles: editableTeam })
  const activeSection = sections.some(({ id }) => id === section) ? section : 'agenda'
  const [appointments, setAppointments] = useState([])
  const [cancelLoading, setCancelLoading] = useState('')
  const [attendanceLoading, setAttendanceLoading] = useState('')
  const [financeData, setFinanceData] = useState([])
  const [financeLoading, setFinanceLoading] = useState(false)
  const swipeStartRef = useRef(null)
  const [swipeVisual, setSwipeVisual] = useState(null)
  const [horaAtual, setHoraAtual] = useState(() => new Date())
  const [barbeiroVisualizado, setBarbeiroVisualizado] = useState('all')
  const [dataCalendario, setDataCalendario] = useState(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Fortaleza',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
  )
  const [modoAgenda, setModoAgenda] = useState('calendario')
  const selectedFinanceDate = financeDate || dataCalendario
  const [disponibilidadeCalendario, setDisponibilidadeCalendario] = useState({})
  const [carregandoDisponibilidade, setCarregandoDisponibilidade] = useState(false)
  const [bloqueiosCalendario, setBloqueiosCalendario] = useState({})
  const [atualizacaoBloqueios, setAtualizacaoBloqueios] = useState(0)
  const [bloqueioEmAndamento, setBloqueioEmAndamento] = useState('')
  const slotSwipeRef = useRef(null)
  const slotSwipeSuprimirClickRef = useRef('')
  const [slotSwipeVisual, setSlotSwipeVisual] = useState(null)

  // Agendamento rápido
  const [quickBookingOpen, setQuickBookingOpen] = useState(false)
  const quickDialogRef = useRef(null)
  const [quickLoading, setQuickLoading] = useState(false)
  const [quickSaving, setQuickSaving] = useState(false)
  const [quickError, setQuickError] = useState('')
  const [quickName, setQuickName] = useState('')
  const [quickPhone, setQuickPhone] = useState('')
  const [quickBarbers, setQuickBarbers] = useState([])
  const [quickServices, setQuickServices] = useState([])
  const [quickBarberId, setQuickBarberId] = useState('')
  const [quickServiceIds, setQuickServiceIds] = useState([])
  const [quickDate, setQuickDate] = useState('')
  const [quickTime, setQuickTime] = useState('')
  const [quickTimes, setQuickTimes] = useState([])
  const [quickTimesLoading, setQuickTimesLoading] = useState(false)
  const [quickPinnedSlot, setQuickPinnedSlot] = useState(null)
  useUpdateBlock(Boolean(quickBookingOpen || quickSaving || loading || (!profile && (email || password)) ||
    attendanceLoading || cancelLoading || swipeVisual || slotSwipeVisual || bloqueioEmAndamento))

  const FUSO_HORARIO = 'America/Fortaleza'

  // Data atual no fuso de Fortaleza
  function dataHojeLocal() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO_HORARIO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
  }

  // Atualizar o relógio automaticamente
  useEffect(() => {
    const intervalo = setInterval(() => {
      setHoraAtual(new Date())
    }, 15000)

    return () => clearInterval(intervalo)
  }, [])

  useEffect(() => {
    if (!quickBookingOpen) return
    const previousFocus = document.activeElement
    quickDialogRef.current?.focus()
    return () => previousFocus?.focus()
  }, [quickBookingOpen])

  // Fechar modal com ESC
  useEffect(() => {
    if (!quickBookingOpen) return

    function fecharComEsc(event) {
      if (event.key === 'Escape' && !quickSaving) {
        setQuickBookingOpen(false)
      }
    }

    document.addEventListener('keydown', fecharComEsc)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', fecharComEsc)
      document.body.style.overflow = ''
    }
  }, [quickBookingOpen, quickSaving])

  // Obter partes de data e hora no fuso de Fortaleza
  function partesDataHora(valor) {
    if (!valor) return null

    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO_HORARIO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(valor))

    const resultado = {}

    partes.forEach((parte) => {
      resultado[parte.type] = parte.value
    })

    return resultado
  }

  // Chave da data no formato AAAA-MM-DD
  function chaveData(valor) {
    const partes = partesDataHora(valor)

    if (!partes) return ''

    return `${partes.year}-${partes.month}-${partes.day}`
  }

  // Horário em minutos, considerando Fortaleza
  function minutosDoDia(valor) {
    const partes = partesDataHora(valor)

    if (!partes) return 0

    return Number(partes.hour) * 60 + Number(partes.minute)
  }

  // Formatar data e hora
  function dataHora(valor) {
    if (!valor) return 'Não informado'

    return new Date(valor).toLocaleString('pt-BR', {
      timeZone: FUSO_HORARIO,
      dateStyle: 'short',
      timeStyle: 'short'
    })
  }

  // Formatar somente o horário
  function somenteHorario(valor) {
    if (!valor) return '--:--'

    return new Date(valor).toLocaleTimeString('pt-BR', {
      timeZone: FUSO_HORARIO,
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Nome da data para os títulos das seções
  function nomeData(data) {
    if (!data) return 'Data não informada'

    const hoje = chaveData(horaAtual)

    const amanha = new Date(horaAtual)
    amanha.setDate(amanha.getDate() + 1)

    const partesAmanha = new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO_HORARIO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(amanha)

    const anoAmanha = partesAmanha.find((p) => p.type === 'year').value
    const mesAmanha = partesAmanha.find((p) => p.type === 'month').value
    const diaAmanha = partesAmanha.find((p) => p.type === 'day').value

    const chaveAmanha = `${anoAmanha}-${mesAmanha}-${diaAmanha}`

    if (data === hoje) return 'Hoje'
    if (data === chaveAmanha) return 'Amanhã'

    const [ano, mes, dia] = data.split('-').map(Number)

    const dataLocal = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0))

    return dataLocal.toLocaleDateString('pt-BR', {
      timeZone: FUSO_HORARIO,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    })
  }

  // Carregar barbeiros e serviços para o agendamento rápido
  async function carregarDadosAgendamentoRapido({ atualizarFiltro = false } = {}) {
    const [barbeirosResult, servicosResult] = await Promise.all([
      supabase
        .from('barbers')
        .select('id, name, active, photo_url')
        .eq('active', true)
        .order('name'),

      supabase
        .from('services')
        .select('id, name, price, slot_units, icon, description, active')
        .eq('active', true)
        .order('name')
    ])

    if (barbeirosResult.error) {
      console.error('Erro ao carregar barbeiros:', barbeirosResult.error)
      setQuickError('Não foi possível carregar os barbeiros.')
      return false
    }

    if (servicosResult.error) {
      console.error('Erro ao carregar serviços:', servicosResult.error)
      setQuickError('Não foi possível carregar os serviços.')
      return false
    }

    setQuickBarbers(barbeirosResult.data || [])
    const servicosAtivos = servicosResult.data || []
    setQuickServices(servicosAtivos)
    setQuickServiceIds((ids) => ids.filter((id) => servicosAtivos.some((service) => service.id === id)))
    if (atualizarFiltro) {
      setBarbeiroVisualizado((id) =>
        barbeirosResult.data?.some((barbeiro) => barbeiro.id === id) ||
        appointments.some((appointment) => appointment.barber_id === id && appointment.barber_name)
          ? id : 'all'
      )
    }

    return true
  }

  async function atualizarAposAlterarCatalogo() {
    const [catalogoAtualizado, agendaAtualizada] = await Promise.all([
      carregarDadosAgendamentoRapido({ atualizarFiltro: true }),
      atualizarAgenda(),
      atualizarContatosDaEquipe()
    ])
    return catalogoAtualizado && agendaAtualizada
  }

  async function atualizarContatosDaEquipe() {
    if (profile?.role !== 'admin') return
    const { data, error } = await supabase.rpc('mr_saloum_listar_perfis_editaveis_v1')
    setTeamProfiles({ userId: profile.userId, records: error ? [] : editableBarberProfiles(data, { role: 'admin' }) })
  }

  async function atualizarAposAlterarContato() {
    const [updated] = await Promise.allSettled([carregarDadosAgendamentoRapido(), atualizarContatosDaEquipe()])
    return updated.status === 'fulfilled' && updated.value
  }

  async function carregarPainel(usuario) {
    setError('')

    const { data: perfil, error: perfilError } = await supabase
      .from('profiles')
      .select('name, role, barber_id')
      .eq('id', usuario.id)
      .single()

    if (
      perfilError ||
      !perfil ||
      !['admin', 'barber'].includes(perfil.role)
    ) {
      setProfile(null)
      setAppointments([])
      setError('Esta conta não possui autorização para acessar o painel.')
      return
    }

    const { data, error: painelError } = await supabase.rpc(
      'painel_agendamentos'
    )

    if (painelError) {
      setError(painelError.message || 'Não foi possível carregar a agenda.')
      return
    }

    const { data: atendimentos, error: atendimentosError } = await supabase.rpc(
      'painel_atendimentos'
    )

    if (atendimentosError) {
      setError(atendimentosError.message || 'Não foi possível carregar as confirmações de realização.')
      return
    }

    const mapaAtendimentos = new Map(
      (atendimentos || []).map((item) => [item.appointment_id, item])
    )
    const agendaComAtendimentos = (Array.isArray(data) ? data : []).map((appointment) => ({
      ...appointment,
      completed_at: mapaAtendimentos.get(appointment.id)?.completed_at || null,
      completed_by: mapaAtendimentos.get(appointment.id)?.completed_by || null
    }))

    setProfile({ ...perfil, userId: usuario.id })
    setAppointments(agendaComAtendimentos)
    setHoraAtual(new Date())

    // Barbeiros ficam vinculados à própria agenda.
    if (perfil.role === 'barber') {
      setQuickBarberId(perfil.barber_id || '')
      setBarbeiroVisualizado(perfil.barber_id || '')
    } else {
      setBarbeiroVisualizado('all')
    }

    await carregarDadosAgendamentoRapido()
  }

  async function atualizarAgenda() {
    setError('')

    const { data, error: painelError } = await supabase.rpc(
      'painel_agendamentos'
    )

    if (painelError) {
      setError(painelError.message || 'Não foi possível atualizar a agenda.')
      return false
    }

    const { data: atendimentos, error: atendimentosError } = await supabase.rpc(
      'painel_atendimentos'
    )

    if (atendimentosError) {
      setError(atendimentosError.message || 'Não foi possível atualizar as confirmações de realização.')
      return false
    }

    const mapaAtendimentos = new Map(
      (atendimentos || []).map((item) => [item.appointment_id, item])
    )
    const agendaComAtendimentos = (Array.isArray(data) ? data : []).map((appointment) => ({
      ...appointment,
      completed_at: mapaAtendimentos.get(appointment.id)?.completed_at || null,
      completed_by: mapaAtendimentos.get(appointment.id)?.completed_by || null
    }))

    setAppointments(agendaComAtendimentos)
    setHoraAtual(new Date())

    return true
  }

  // Abrir o formulário de agendamento rápido
  function abrirAgendamentoRapido() {
    setQuickError('')
    setQuickName('')
    setQuickPhone('')
    setQuickServiceIds([])
    setQuickTime('')
    setQuickTimes([])
    setQuickPinnedSlot(null)

    setQuickDate(dataHojeLocal())

    if (profile?.role === 'barber') {
      setQuickBarberId(profile.barber_id || '')
    } else {
      setQuickBarberId('')
    }

    setQuickBookingOpen(true)
  }

  // Abre o cadastro manual já vinculado ao horário encerrado selecionado.
  function abrirAgendamentoNoHorario(barberId, date, time) {
    if (!quickBarbers.some(({ id }) => id === barberId)) {
      setError('Este barbeiro está indisponível para novos agendamentos.')
      return
    }
    setQuickError('')
    setQuickName('')
    setQuickPhone('')
    setQuickServiceIds([])
    setQuickTimes([time])
    setQuickDate(date)
    setQuickBarberId(barberId)
    setQuickTime('')
    setQuickPinnedSlot({ barberId, date, time })
    setQuickBookingOpen(true)
  }

  // Selecionar ou remover serviço
  function alternarServicoRapido(serviceId) {
    setQuickError('')
    setQuickTime('')

    setQuickServiceIds((atuais) => {
      if (atuais.includes(serviceId)) {
        return atuais.filter((id) => id !== serviceId)
      }

      return [...atuais, serviceId]
    })
  }

  const quickSelectedServices = quickServices.filter((service) =>
    quickServiceIds.includes(service.id)
  )

  const quickTotal = quickSelectedServices.reduce(
    (total, service) => total + Number(service.price || 0),
    0
  )

  const quickDuration = quickServiceIds.length > 0
  ? calcularDuracaoSlots(quickSelectedServices)
  : 0

  const quickBarberActive = quickBarbers.some(({ id }) => id === quickBarberId)

  // Consultar horários disponíveis usando a mesma função do site público
  useEffect(() => {
    let ativo = true

    async function consultarHorarios() {
      if (
        !quickBookingOpen ||
        !quickBarberActive ||
        !quickDate ||
        quickServiceIds.length === 0 ||
        quickDuration < 1
      ) {
        setQuickTimes(quickBarberActive && quickPinnedSlot && quickPinnedSlot.barberId === quickBarberId && quickPinnedSlot.date === quickDate
          ? [quickPinnedSlot.time]
          : [])
        setQuickTime('')
        setQuickTimesLoading(false)
        return
      }

      setQuickTimesLoading(true)
      const horarioFixado = quickPinnedSlot &&
        quickPinnedSlot.barberId === quickBarberId &&
        quickPinnedSlot.date === quickDate
        ? quickPinnedSlot.time
        : ''
      setQuickTime(horarioFixado)
      setQuickError('')

      const { data, error: disponibilidadeError } = await supabase.rpc(
        'consultar_disponibilidade',
        {
          p_barber_id: quickBarberId,
          p_data: quickDate,
          p_duracao_slots: quickDuration
        }
      )

      if (!ativo) return

      if (disponibilidadeError) {
        console.error(
          'Erro ao consultar disponibilidade:',
          disponibilidadeError
        )

        setQuickTimes([])
        setQuickError('Não foi possível consultar os horários disponíveis.')
      } else {
        const horariosLivres = (data || [])
          .filter((item) => item.disponivel)
          .map((item) => String(item.horario).slice(0, 5))

        if (horarioFixado && !horariosLivres.includes(horarioFixado)) {
          horariosLivres.unshift(horarioFixado)
        }

        setQuickTimes(horariosLivres)
        if (horarioFixado) setQuickTime(horarioFixado)
      }

      setQuickTimesLoading(false)
    }

    consultarHorarios()

    return () => {
      ativo = false
    }
  }, [
    quickBookingOpen,
    quickBarberId,
    quickBarberActive,
    quickDate,
    quickServiceIds,
    quickDuration,
    quickPinnedSlot
  ])

  // Salvar agendamento presencial
  async function salvarAgendamentoRapido(event) {
    event.preventDefault()

    if (quickSaving) return

    setQuickError('')

    const nome = quickName.trim()
    const telefone = quickPhone.replace(/\D/g, '')

    if (nome.length < 3) {
      setQuickError('Informe o nome completo do cliente.')
      return
    }

    if (telefone.length !== 10 && telefone.length !== 11) {
      setQuickError('Informe um WhatsApp válido com DDD.')
      return
    }

    if (!quickBarberId) {
      setQuickError('Selecione um barbeiro.')
      return
    }
    if (!quickBarberActive) {
      setQuickError('Este barbeiro está indisponível para novos agendamentos.')
      return
    }

    if (quickServiceIds.length === 0) {
      setQuickError('Selecione pelo menos um serviço.')
      return
    }

    if (!quickDate || !quickTime) {
      setQuickError('Selecione a data e o horário.')
      return
    }

    setQuickSaving(true)

    try {
      const { error: salvarError } = await supabase.rpc(
        'admin_criar_agendamento_manual',
        {
          p_customer_name: nome,
          p_customer_whatsapp: telefone,
          p_barber_id: quickBarberId,
          p_data: quickDate,
          p_horario: quickTime,
          p_service_ids: quickServiceIds
        }
      )

      if (salvarError) {
        console.error('Erro ao criar agendamento manual:', salvarError)
        setQuickError(
          salvarError.message || 'Não foi possível criar o agendamento.'
        )
        return
      }

      setQuickBookingOpen(false)
      setSuccess(`Agendamento de ${nome} criado com sucesso!`)

      await atualizarAgenda()
      setAtualizacaoBloqueios((valor) => valor + 1)
    } catch (erro) {
      console.error('Erro inesperado:', erro)
      setQuickError('Ocorreu um erro inesperado. Tente novamente.')
    } finally {
      setQuickSaving(false)
    }
  }

  async function cancelarAgendamento(appointment) {
    const confirmado = window.confirm(
      `Deseja realmente cancelar o agendamento de ${appointment.customer_name} com ${appointment.barber_name}?`
    )

    if (!confirmado) return

    setCancelLoading(appointment.id)
    setError('')
    setSuccess('')

    const { error: cancelError } = await supabase.rpc(
      'admin_cancelar_agendamento',
      {
        p_appointment_id: appointment.id
      }
    )

    if (cancelError) {
      console.error('Erro ao cancelar agendamento:', cancelError)

      setError(
        cancelError.message || 'Não foi possível cancelar o agendamento.'
      )
    } else {
      setSuccess(
        `Agendamento de ${appointment.customer_name} cancelado com sucesso!`
      )

      await atualizarAgenda()
    }

    setCancelLoading('')
  }

  async function marcarAtendimento(appointment, realizado = true) {
    if (!appointment || appointment.status !== 'confirmed') return

    setAttendanceLoading(appointment.id)
    setError('')
    setSuccess('')

    const { error: attendanceError } = await supabase.rpc(
      'admin_marcar_atendimento',
      {
        p_appointment_id: appointment.id,
        p_realizado: realizado
      }
    )

    if (attendanceError) {
      console.error('Erro ao atualizar realização do corte:', attendanceError)
      setError(attendanceError.message || 'Não foi possível atualizar a realização do corte.')
    } else {
      setSuccess(realizado
        ? `Corte de ${appointment.customer_name} marcado como realizado.`
        : `Confirmação do corte de ${appointment.customer_name} desfeita.`)
      await atualizarAgenda()
    }

    setAttendanceLoading('')
  }

  function iniciarSwipeAgendamento(event, appointment) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (attendanceLoading || cancelLoading) return

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Alguns navegadores podem não permitir captura neste elemento.
    }

    swipeStartRef.current = {
      appointmentId: appointment.id,
      x: event.clientX,
      y: event.clientY
    }
    setSwipeVisual({
      appointmentId: appointment.id,
      delta: 0,
      dragging: true,
      direction: ''
    })
  }

  function moverSwipeAgendamento(event, appointment) {
    const inicio = swipeStartRef.current
    if (!inicio || inicio.appointmentId !== appointment.id) return

    const delta = Math.max(-150, Math.min(150, event.clientX - inicio.x))
    setSwipeVisual({
      appointmentId: appointment.id,
      delta,
      dragging: true,
      direction: delta > 0 ? 'complete' : delta < 0 ? 'cancel' : ''
    })
  }

  function finalizarSwipeAgendamento(event, appointment) {
    const inicio = swipeStartRef.current
    swipeStartRef.current = null

    if (!inicio || inicio.appointmentId !== appointment.id) {
      setSwipeVisual(null)
      return
    }

    const direction = appointmentSwipeAction(inicio, event)
    if (!direction || attendanceLoading || cancelLoading) {
      setSwipeVisual(null)
      return
    }

    setSwipeVisual({
      appointmentId: appointment.id,
      delta: direction === 'complete' ? 125 : -125,
      dragging: false,
      direction
    })

    window.setTimeout(() => {
      if (direction === 'complete') {
        marcarAtendimento(appointment, !appointment.completed_at)
      } else {
        cancelarAgendamento(appointment)
      }
      window.setTimeout(() => setSwipeVisual(null), 450)
    }, 180)
  }

  const adminId = profile?.role === 'admin' ? profile.userId : null
  const negarAcessoCatalogo = useCallback((message) => {
    setCatalogAccess({ userId: adminId, allowed: false })
    setError(message)
  }, [adminId])
  useEffect(() => {
    if (!adminId) return
    let active = true
    async function checkAccess() {
      try {
        const { data, error } = await supabase.rpc('mr_saloum_pode_gerenciar_catalogo_v1')
        if (active) setCatalogAccess({ userId: adminId, allowed: !error && data === true })
      } catch {
        if (active) setCatalogAccess({ userId: adminId, allowed: false })
      }
    }
    async function listContacts() {
      try {
        const { data, error } = await supabase.rpc('mr_saloum_listar_perfis_editaveis_v1')
        if (active && !error) setTeamProfiles({ userId: adminId, records: editableBarberProfiles(data, { role: 'admin' }) })
      } catch {
        // A aba usa somente os perfis autorizados na sessão.
      }
    }
    checkAccess()
    listContacts()
    return () => { active = false }
  }, [adminId])

  useEffect(() => {
    let ativo = true

    async function carregarFinanceiro() {
      if (!profile || activeSection !== 'financeiro' || !selectedFinanceDate) return

      setFinanceLoading(true)
      const { data, error: financeError } = await supabase.rpc(
        'painel_financeiro',
        { p_data: selectedFinanceDate }
      )

      if (!ativo) return

      if (financeError) {
        console.error('Erro ao carregar financeiro:', financeError)
        setFinanceData([])
        setError(financeError.message || 'Não foi possível carregar o financeiro.')
      } else {
        setFinanceData(Array.isArray(data) ? data : [])
      }

      setFinanceLoading(false)
    }

    carregarFinanceiro()

    return () => {
      ativo = false
    }
  }, [profile, activeSection, selectedFinanceDate, appointments])

  useEffect(() => {
    let ativo = true

    async function verificarLogin() {
      const { data } = await supabase.auth.getSession()

      if (!ativo) return

      const usuario = data.session?.user

      if (usuario && !usuario.is_anonymous) {
        await carregarPainel(usuario)
      }

      if (ativo) setChecking(false)
    }

    verificarLogin()

    return () => {
      ativo = false
    }
  }, [])

  async function entrar(event) {
    event.preventDefault()

    setLoading(true)
    setError('')
    setSuccess('')

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    })

    if (loginError) {
      setError('E-mail ou senha incorretos.')
      setLoading(false)
      return
    }

    await carregarPainel(data.user)

    setPassword('')
    setLoading(false)
  }

  async function sair() {
    await supabase.auth.signOut()

    setProfile(null)
    setAppointments([])
    setEmail('')
    setPassword('')
    setError('')
    setSuccess('')
    setQuickBookingOpen(false)
    setQuickBarbers([])
    setQuickServices([])
    setSection('agenda')
    setContactTarget('')
    setMobileBarberId('')
    setFinanceDate('')
    setFinanceData([])
    setCatalogAccess({ userId: null, allowed: false })
    setTeamProfiles({ userId: null, records: [] })
  }

  const nomePerfil = profile?.name || 'Barbeiro'

  const hoje = chaveData(horaAtual)
  const minutosAgora = minutosDoDia(horaAtual)
  const dataSelecionadaEhSabado = (() => {
    if (!selectedFinanceDate) return false
    const [ano, mes, dia] = selectedFinanceDate.split('-').map(Number)
    return new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay() === 6
  })()
  const atendimentosDoFinanceiro = new Map()
  if (activeSection === 'financeiro') {
    for (const appointment of appointments) {
      if (appointment.status === 'confirmed' && appointment.completed_at && appointment.barber_id &&
          chaveData(appointment.starts_at) === selectedFinanceDate) {
        const id = appointment.barber_id
        atendimentosDoFinanceiro.set(id, (atendimentosDoFinanceiro.get(id) ?? 0) + 1)
      }
    }
  }

  function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    })
  }

  const barbeirosHistoricos = profile?.role === 'admin'
    ? historicalBarbers(quickBarbers, appointments)
    : []
  const opcoesBarbeirosAgenda = [...quickBarbers, ...barbeirosHistoricos]

  function pertenceAoBarbeiro(appointment, barberId) {
    if (barberId === 'all') return true
    if (!barberId) return false

    const barber = opcoesBarbeirosAgenda.find((item) => item.id === barberId)
    const nomeBarbeiro = barber?.name ||
      (profile?.barber_id === barberId ? profile.name : '')

    if (appointment.barber_id) {
      return appointment.barber_id === barberId
    }

    return Boolean(
      nomeBarbeiro && appointment.barber_name === nomeBarbeiro
    )
  }

  const agendamentosDoBarbeiro = appointments.filter((appointment) => {
    if (profile?.role === 'barber') {
      return pertenceAoBarbeiro(appointment, profile.barber_id)
    }

    return barbeiroVisualizado === 'all' ||
      pertenceAoBarbeiro(appointment, barbeiroVisualizado)
  })

  const agendamentosConfirmados = agendamentosDoBarbeiro
    .filter((appointment) => appointment.status === 'confirmed')
    .sort((a, b) => {
      return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    })

  const agendamentosCancelados = agendamentosDoBarbeiro
    .filter((appointment) => {
      if (appointment.status !== 'cancelled') return false

      const dataCancelamento = chaveData(appointment.starts_at)

      if (!dataCancelamento) return false
      if (dataCancelamento < hoje) return false
      if (dataCancelamento > hoje) return true

      return minutosAgora < 18 * 60
    })
    .sort((a, b) => {
      return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    })

  function agruparPorData(lista) {
    const grupos = {}

    lista.forEach((appointment) => {
      const data = chaveData(appointment.starts_at)

      if (!grupos[data]) {
        grupos[data] = []
      }

      grupos[data].push(appointment)
    })

    return Object.entries(grupos)
      .sort(([dataA], [dataB]) => dataA.localeCompare(dataB))
      .map(([data, itens]) => ({
        data,
        itens: itens.sort((a, b) => {
          return (
            new Date(a.starts_at).getTime() -
            new Date(b.starts_at).getTime()
          )
        })
      }))
  }

  const gruposConfirmados = agruparPorData(agendamentosConfirmados)
  const gruposCancelados = agruparPorData(agendamentosCancelados)

  function deslocarDataCalendario(dias) {
    const [ano, mes, dia] = dataCalendario.split('-').map(Number)
    const data = new Date(ano, mes - 1, dia, 12)
    data.setDate(data.getDate() + dias)

    const anoNovo = data.getFullYear()
    const mesNovo = String(data.getMonth() + 1).padStart(2, '0')
    const diaNovo = String(data.getDate()).padStart(2, '0')

    setDataCalendario(`${anoNovo}-${mesNovo}-${diaNovo}`)
  }

  function textoDataCalendario(valor) {
    if (!valor) return ''
    const [ano, mes, dia] = valor.split('-').map(Number)
    return new Date(ano, mes - 1, dia, 12).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    })
  }

 function duracaoAgendamento(appointment) {
  if (appointment.ends_at && appointment.starts_at) {
    const diferenca =
      (new Date(appointment.ends_at).getTime() -
        new Date(appointment.starts_at).getTime()) / 60000

    if (Number.isFinite(diferenca) && diferenca > 0) {
      return diferenca
    }
  }

  const slots = (appointment.items || [])
    .filter((item) => {
      return (
        item.service_id !== SERVICE_SOBRANCELHA_ID &&
        String(item.service_name || '').toLowerCase() !== 'sobrancelha'
      )
    })
    .reduce(
      (total, item) => total + Number(item.slot_units || 0),
      0
    )

  return Math.max(1, slots) * 35
}

  const agendamentosDoDia = agendamentosConfirmados.filter(
    (appointment) => chaveData(appointment.starts_at) === dataCalendario
  )

  const barbeirosAgenda = (() => {
    if (profile?.role === 'barber') {
      const proprio = quickBarbers.find(
        (barber) => barber.id === profile.barber_id
      )
      return proprio
        ? [proprio]
        : [{
            id: profile.barber_id || 'meu-calendario',
            name: profile.name || 'Minha agenda'
          }]
    }

    if (barbeiroVisualizado === 'all') {
      const idsDoDia = new Set(agendamentosDoDia.map((appointment) => appointment.barber_id))
      return [...quickBarbers, ...barbeirosHistoricos.filter(({ id }) => idsDoDia.has(id))]
    }

    return opcoesBarbeirosAgenda.filter(
      (barber) => barber.id === barbeiroVisualizado
    )
  })()

  // Consulta horários livres de 35 minutos para mostrar os espaços disponíveis
  // sem inventar horários com base apenas nos intervalos entre agendamentos.
  const idsBarbeirosCalendario = barbeirosAgenda
    .filter((barber) => barber.active !== false)
    .map((barber) => barber.id).join(',')

  useEffect(() => {
    let ativo = true

    async function consultarDisponibilidadeCalendario() {
      if (!dataCalendario || !idsBarbeirosCalendario) {
        setDisponibilidadeCalendario({})
        setCarregandoDisponibilidade(false)
        return
      }

      setCarregandoDisponibilidade(true)
      const resultados = await Promise.all(
        idsBarbeirosCalendario.split(',').map(async (barberId) => {
          const { data, error: disponibilidadeError } = await supabase.rpc(
            'consultar_disponibilidade',
            {
              p_barber_id: barberId,
              p_data: dataCalendario,
              p_duracao_slots: 1
            }
          )

          if (disponibilidadeError) {
            console.error('Erro ao consultar disponibilidade do calendário:', disponibilidadeError)
            return [barberId, { error: true, horarios: [] }]
          }

          const todosHorarios = (data || []).map((item) => ({
            horario: String(item.horario).slice(0, 5),
            disponivel: Boolean(item.disponivel)
          }))

          const horarios = todosHorarios
            .filter((item) => item.disponivel)
            .map((item) => item.horario)

          return [barberId, { error: false, horarios, todosHorarios }]
        })
      )

      if (!ativo) return
      setDisponibilidadeCalendario(Object.fromEntries(resultados))
      setCarregandoDisponibilidade(false)
    }

    consultarDisponibilidadeCalendario()

    return () => {
      ativo = false
    }
  }, [dataCalendario, idsBarbeirosCalendario, atualizacaoBloqueios])

  // Bloqueios são consultados por RPC autenticada, nunca diretamente na tabela.
  useEffect(() => {
    let ativo = true
    async function consultarBloqueios() {
      if (!profile || !dataCalendario || !idsBarbeirosCalendario) {
        if (ativo) setBloqueiosCalendario({})
        return
      }
      const { data, error: erroBloqueios } = await supabase.rpc('admin_listar_bloqueios', {
        p_data: dataCalendario,
        p_barber_id: profile.role === 'barber' ? profile.barber_id : null
      })
      if (!ativo) return
      if (erroBloqueios) {
        console.error('Erro ao carregar bloqueios:', erroBloqueios)
        setError(erroBloqueios.message || 'Não foi possível consultar os horários bloqueados.')
        setBloqueiosCalendario({})
        return
      }
      const mapa = {}
      ;(data || []).forEach((item) => {
        if (!mapa[item.barber_id]) mapa[item.barber_id] = []
        mapa[item.barber_id].push(String(item.horario).slice(0, 5))
      })
      setBloqueiosCalendario(mapa)
    }
    consultarBloqueios()
    return () => { ativo = false }
  }, [profile?.role, profile?.barber_id, dataCalendario, idsBarbeirosCalendario, atualizacaoBloqueios])

  async function alterarBloqueio(barberId, horario, bloquear) {
    const chave = `${barberId}-${horario}`
    if (bloqueioEmAndamento) return
    if (profile?.role === 'barber' && profile.barber_id !== barberId) return
    setBloqueioEmAndamento(chave)
    setError('')
    setSuccess('')
    try {
      const { error: erroBloqueio } = await supabase.rpc('admin_alternar_bloqueio', {
        p_barber_id: barberId,
        p_data: dataCalendario,
        p_horario: horario,
        p_bloquear: bloquear
      })
      if (erroBloqueio) throw erroBloqueio
      setSuccess(`Horário ${horario} ${bloquear ? 'bloqueado' : 'liberado'} com sucesso.`)
      setAtualizacaoBloqueios((valor) => valor + 1)
    } catch (erro) {
      setError(erro.message || 'Não foi possível alterar o bloqueio.')
    } finally {
      setBloqueioEmAndamento('')
      setSlotSwipeVisual(null)
    }
  }

  function iniciarSwipeSlot(event, barberId, horario, bloqueado) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (bloqueioEmAndamento) return
    slotSwipeRef.current = { chave: `${barberId}-${horario}`, x: event.clientX, y: event.clientY, barberId, horario, bloqueado }
    setSlotSwipeVisual({ chave: `${barberId}-${horario}`, delta: 0 })
  }

  function moverSwipeSlot(event, barberId, horario) {
    const inicio = slotSwipeRef.current
    if (!inicio || inicio.chave !== `${barberId}-${horario}`) return
    const deltaX = event.clientX - inicio.x
    const deltaY = event.clientY - inicio.y
    if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* sem captura */ }
      setSlotSwipeVisual({ chave: inicio.chave, delta: Math.max(-120, Math.min(120, deltaX)) })
    }
  }

  function finalizarSwipeSlot(event, barberId, horario) {
    const inicio = slotSwipeRef.current
    slotSwipeRef.current = null
    setSlotSwipeVisual(null)
    if (!inicio || inicio.chave !== `${barberId}-${horario}`) return
    const dx = event.clientX - inicio.x
    const dy = event.clientY - inicio.y
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.25) return
    slotSwipeSuprimirClickRef.current = inicio.chave
    // O gesto só age na direção esperada para o estado atual.
    if ((!inicio.bloqueado && dx < 0) || (inicio.bloqueado && dx > 0)) {
      alterarBloqueio(barberId, horario, !inicio.bloqueado)
    }
  }

  const HORA_INICIO_AGENDA = 8
  const HORA_FIM_AGENDA = 21
  const ALTURA_HORA_AGENDA = 64
  const ALTURA_TOTAL_AGENDA =
    (HORA_FIM_AGENDA - HORA_INICIO_AGENDA) * ALTURA_HORA_AGENDA

  // Carregamento inicial
  if (checking) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            MR.SAL<span>OUM</span>
          </div>

          <p>Verificando acesso administrativo...</p>
        </div>
      </main>
    )
  }

  // Tela de login
  if (!profile) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            MR.SAL<span>OUM</span>
          </div>

          <p className="auth-eyebrow">ÁREA RESTRITA</p>

          <h1>Painel administrativo</h1>

          <p className="auth-description">
            Entre com seu e-mail e senha de acesso.
          </p>

          <form onSubmit={entrar}>
            <label htmlFor="admin-email">E-mail</label>

            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="username"
              required
            />

            <label htmlFor="admin-password">Senha</label>

            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              autoComplete="current-password"
              required
            />

            {error && (
              <p className="auth-error">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading}>
              {loading ? 'VERIFICANDO...' : 'ENTRAR NO PAINEL'}
            </button>
          </form>

          <small>MR.SALOUM — ACESSO ADMINISTRATIVO</small>
        </div>
      </main>
    )
  }

  // Cartão compacto de agendamento para a visualização em lista
  function CartaoAgendamento({ appointment, cancelado = false }) {
    const servicos = (appointment.items || [])
      .map((item) => item.service_name + (!item.active ? ' (cancelado)' : ''))
      .filter(Boolean)
      .join(' + ') || 'Serviço não informado'

    return (
      <article className={`admin-appointment-row ${cancelado ? 'is-cancelled' : ''} ${appointment.completed_at ? 'is-completed' : ''}`}>
        <div className="admin-appointment-time">
          <strong>{somenteHorario(appointment.starts_at)}</strong>
          <span>{appointment.ends_at ? `até ${somenteHorario(appointment.ends_at)}` : 'horário'}</span>
        </div>

        <div className="admin-appointment-main">
          <strong className="admin-appointment-customer">{appointment.customer_name}</strong>
          <span className="admin-appointment-service">{servicos}</span>
          <span className="admin-appointment-meta">
            {appointment.barber_name || 'Barbeiro não informado'}
            {appointment.customer_whatsapp ? ` · ${appointment.customer_whatsapp}` : ''}
          </span>
        </div>

        <div className="admin-appointment-actions">
          <span className={`admin-status ${cancelado ? 'cancelled' : appointment.completed_at ? 'completed' : 'confirmed'}`}>
            {cancelado ? 'Cancelado' : appointment.completed_at ? 'Realizado' : 'Confirmado'}
          </span>
          {!cancelado && (
            <button
              type="button"
              className="admin-cancel-button"
              onClick={() => cancelarAgendamento(appointment)}
              disabled={cancelLoading !== ''}
            >
              {cancelLoading === appointment.id ? 'Cancelando…' : 'Cancelar'}
            </button>
          )}
        </div>
      </article>
    )
  }

  function renderizarGrupos(grupos, cancelado = false) {
    return (
      <div className="admin-appointment-groups">
        {grupos.map((grupo) => (
          <section className={`admin-appointment-day ${cancelado ? 'is-cancelled' : ''}`} key={grupo.data}>
            <header className="admin-appointment-day-heading">
              <h3>{nomeData(grupo.data)}</h3>
              <span>{grupo.itens.length} {grupo.itens.length === 1 ? 'agendamento' : 'agendamentos'}</span>
            </header>
            <div className="admin-appointment-list">
              {grupo.itens.map((appointment) => (
                <CartaoAgendamento
                  key={appointment.id}
                  appointment={appointment}
                  cancelado={cancelado}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  // Painel principal
  return (
    <main className="admin-shell">
      {/* MODAL AGENDAMENTO RÁPIDO */}
      {quickBookingOpen && (
        <div
          onClick={() => {
            if (!quickSaving) setQuickBookingOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
            overflowY: 'auto'
          }}
        >
          <section
            ref={quickDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-booking-title"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 570,
              maxHeight: '92vh',
              overflowY: 'auto',
              background: '#1a1a1a',
              border: '1px solid #444',
              borderRadius: 16,
              padding: '22px',
              boxShadow: '0 20px 70px rgba(0,0,0,0.5)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 20
              }}
            >
              <div>
                <span
                  style={{
                    color: '#c5a46d',
                    fontSize: 11,
                    letterSpacing: 2,
                    fontWeight: 700
                  }}
                >
                  PAINEL ADMINISTRATIVO
                </span>

                <h2 id="quick-booking-title" style={{ margin: '6px 0', fontSize: 22 }}>
                  Agendamento rápido
                </h2>

                <p style={{ color: '#999', fontSize: 13, margin: 0 }}>
                  Cadastre um cliente presencial ou por telefone.
                </p>
              </div>

              <button
                type="button"
                disabled={quickSaving}
                onClick={() => setQuickBookingOpen(false)}
                aria-label="Fechar"
                style={{
                  border: '1px solid #444',
                  borderRadius: 8,
                  background: '#252525',
                  color: '#ddd',
                  fontSize: 23,
                  width: 36,
                  height: 36,
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                ×
              </button>
            </div>

            <form onSubmit={salvarAgendamentoRapido}>
              <div style={{ display: 'grid', gap: 7, marginBottom: 16 }}>
                <label style={{ color: '#ddd', fontSize: 13 }}>
                  Nome do cliente
                </label>

                <input
                  type="text"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder="Nome completo"
                  required
                  minLength={3}
                  style={quickInputStyle}
                />
              </div>

              <div style={{ display: 'grid', gap: 7, marginBottom: 18 }}>
                <label style={{ color: '#ddd', fontSize: 13 }}>
                  WhatsApp do cliente
                </label>

                <input
                  type="tel"
                  value={quickPhone}
                  onChange={(e) => setQuickPhone(e.target.value)}
                  placeholder="(84) 99999-9999"
                  required
                  style={quickInputStyle}
                />
              </div>

              <div style={{ display: 'grid', gap: 7, marginBottom: 18 }}>
                <label style={{ color: '#ddd', fontSize: 13 }}>
                  Barbeiro
                </label>

                {profile.role === 'admin' ? (
                  <select
                    value={quickBarberId}
                    onChange={(e) => {
                      setQuickBarberId(e.target.value)
                      setQuickTime('')
                      setQuickError('')
                    }}
                    required
                    style={quickInputStyle}
                  >
                    <option value="">Selecione o barbeiro</option>

                    {quickBarbers.map((barber) => (
                      <option key={barber.id} value={barber.id}>
                        {barber.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div
                    style={{
                      ...quickInputStyle,
                      color: '#c5a46d',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    {quickBarbers.find((b) => b.id === profile.barber_id)?.name ||
                      nomePerfil}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <label
                  style={{
                    color: '#ddd',
                    fontSize: 13,
                    display: 'block',
                    marginBottom: 10
                  }}
                >
                  Serviços
                </label>

                {quickServices.length === 0 ? (
                  <p style={{ color: '#999', fontSize: 13 }}>
                    Nenhum serviço ativo encontrado.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {quickServices.map((service) => {
                      const selecionado = quickServiceIds.includes(service.id)

                      return (
                        <button
                          key={service.id}
                          type="button"
                          onClick={() => alternarServicoRapido(service.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            textAlign: 'left',
                            padding: '12px 13px',
                            borderRadius: 9,
                            border: selecionado
                              ? '1px solid #c5a46d'
                              : '1px solid #383838',
                            background: selecionado ? '#30291e' : '#222',
                            color: '#eee',
                            cursor: 'pointer'
                          }}
                        >
                          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <span
                              style={{
                                width: 19,
                                height: 19,
                                borderRadius: 5,
                                border: selecionado
                                  ? '1px solid #c5a46d'
                                  : '1px solid #666',
                                background: selecionado ? '#c5a46d' : 'transparent',
                                color: '#171717',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 13,
                                fontWeight: 800,
                                flexShrink: 0
                              }}
                            >
                              {selecionado ? '✓' : ''}
                            </span>

                            <span>
                              <strong style={{ display: 'block', fontSize: 13 }}>
                                {service.name}
                              </strong>

                              <small style={{ color: '#999', fontSize: 11 }}>
                                {service.id === SERVICE_SOBRANCELHA_ID
  ? quickSelectedServices.some(
      (item) => item.id !== SERVICE_SOBRANCELHA_ID
    )
    ? 'Adicional — sem tempo extra'
    : '1 intervalo de 35 min'
  : `${Number(service.slot_units)} intervalo(s) de 35 min`}
                              </small>
                            </span>
                          </span>

                          <strong
                            style={{
                              color: '#c5a46d',
                              fontSize: 13,
                              whiteSpace: 'nowrap'
                            }}
                          >
                            R$ {Number(service.price).toFixed(2).replace('.', ',')}
                          </strong>
                        </button>
                      )
                    })}
                  </div>
                )}

                {quickSelectedServices.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 13,
                      background: '#252525',
                      border: '1px solid #3b3b3b',
                      borderRadius: 9,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10
                    }}
                  >
                    <div>
                      <span style={{ color: '#aaa', fontSize: 11 }}>
                        {quickSelectedServices.length} serviço(s) selecionado(s)
                      </span>

                      <p style={{ color: '#999', fontSize: 11, margin: '4px 0 0' }}>
                        Duração: {quickDuration * 35} minutos
                      </p>
                    </div>

                    <strong style={{ color: '#c5a46d', fontSize: 17 }}>
                      R$ {quickTotal.toFixed(2).replace('.', ',')}
                    </strong>
                  </div>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginBottom: 18
                }}
              >
                <div style={{ display: 'grid', gap: 7 }}>
                  <label style={{ color: '#ddd', fontSize: 13 }}>
                    Data
                  </label>

                  <input
                    type="date"
                    value={quickDate}
                    min={dataHojeLocal()}
                    onChange={(e) => {
                      setQuickDate(e.target.value)
                      setQuickTime('')
                      setQuickError('')
                    }}
                    required
                    style={quickInputStyle}
                  />
                </div>

                <div style={{ display: 'grid', gap: 7 }}>
                  <label style={{ color: '#ddd', fontSize: 13 }}>
                    Horário
                  </label>

                  <select
                    value={quickTime}
                    onChange={(e) => {
                      setQuickTime(e.target.value)
                      setQuickError('')
                    }}
                    disabled={
                      !quickBarberId ||
                      !quickDate ||
                      quickServiceIds.length === 0 ||
                      quickTimesLoading ||
                      quickTimes.length === 0
                    }
                    required
                    style={{
                      ...quickInputStyle,
                      opacity: quickTimesLoading ? 0.6 : 1
                    }}
                  >
                    <option value="">
                      {quickTimesLoading
                        ? 'Buscando...'
                        : quickTimes.length === 0
                          ? 'Sem horários'
                          : 'Escolha'}
                    </option>

                    {quickTimes.map((horario) => (
                      <option key={horario} value={horario}>
                        {horario}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!quickBarberId && profile.role === 'admin' && (
                <p style={{ color: '#999', fontSize: 12, marginTop: -7 }}>
                  Selecione um barbeiro para consultar os horários.
                </p>
              )}

              {quickServiceIds.length === 0 && (
                <p style={{ color: '#999', fontSize: 12, marginTop: -7 }}>
                  Selecione os serviços para calcular os horários disponíveis.
                </p>
              )}

              {quickTimesLoading && (
                <p style={{ color: '#c5a46d', fontSize: 12 }}>
                  Consultando disponibilidade...
                </p>
              )}

              {!quickTimesLoading &&
                quickBarberActive &&
                quickDate &&
                quickServiceIds.length > 0 &&
                quickTimes.length === 0 &&
                !quickError && (
                  <p style={{ color: '#e6b4a0', fontSize: 12 }}>
                    Não há horários livres para essa seleção.
                  </p>
                )}

              {quickError && (
                <div
                  role="alert"
                  style={{
                    background: '#3b2020',
                    border: '1px solid #713838',
                    color: '#ffaaaa',
                    padding: 11,
                    borderRadius: 8,
                    fontSize: 13,
                    marginBottom: 14
                  }}
                >
                  {quickError}
                </div>
              )}

              <button
                type="submit"
                disabled={
                  quickSaving ||
                  quickTimesLoading ||
                  !quickName.trim() ||
                  !quickPhone.trim() ||
                  !quickBarberActive ||
                  quickServiceIds.length === 0 ||
                  !quickDate ||
                  !quickTime
                }
                style={{
                  width: '100%',
                  padding: 15,
                  border: 'none',
                  borderRadius: 9,
                  background: '#c5a46d',
                  color: '#171717',
                  fontWeight: 800,
                  fontSize: 13,
                  letterSpacing: 0.5,
                  cursor: 'pointer',
                  opacity:
                    quickSaving ||
                    quickTimesLoading ||
                    !quickName.trim() ||
                    !quickPhone.trim() ||
                    !quickBarberActive ||
                    quickServiceIds.length === 0 ||
                    !quickDate ||
                    !quickTime
                      ? 0.5
                      : 1
                }}
              >
                {quickSaving
                  ? 'SALVANDO AGENDAMENTO...'
                  : 'CONFIRMAR AGENDAMENTO'}
              </button>
            </form>
          </section>
        </div>
      )}

      <div inert={quickBookingOpen ? true : undefined}>
      <AdminNavigation
        name={nomePerfil}
        role={profile.role === 'admin' ? 'Administrador' : 'Barbeiro'}
        sections={sections}
        active={activeSection}
        onLogout={sair}
        onSelect={(id) => {
          if (id === activeSection) return
          setSection(id)
          setContactTarget('')
          setError('')
          setSuccess('')
        }}
      />

      <div className="admin-shell-content">

      {error && (
        <div role="alert"
          style={{
            background: '#3b2020',
            border: '1px solid #713838',
            color: '#ffaaaa',
            padding: 14,
            borderRadius: 8,
            marginBottom: 18
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div role="status"
          style={{
            background: '#1d3526',
            border: '1px solid #376447',
            color: '#a5e5b8',
            padding: 14,
            borderRadius: 8,
            marginBottom: 18
          }}
        >
          {success}
        </div>
      )}

      {activeSection === 'agenda' && (
      <div data-admin-section="agenda">
      {/* CONTROLES E CALENDÁRIO PRINCIPAL */}
      <section
        style={{
          background: '#1d1d1d',
          border: '1px solid #333',
          borderRadius: 14,
          padding: 18,
          marginBottom: 28
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 14,
            marginBottom: 18
          }}
        >
          <div>
            <span style={{ color: '#c5a46d', fontSize: 11, letterSpacing: 1.5 }}>
              ORGANIZAÇÃO DA BARBEARIA
            </span>
            <h2 style={{ margin: '5px 0 0', fontSize: 22 }}>
              Calendário de horários
            </h2>
          </div>

          <div className="admin-agenda-view-controls">
            {profile.role === 'admin' && (
              <select
                className={modoAgenda === 'calendario' && barbeiroVisualizado === 'all' && barbeirosAgenda.length ? 'admin-calendar-desktop-select' : undefined}
                aria-label="Selecionar agenda do barbeiro"
                value={barbeiroVisualizado}
                onChange={(event) => setBarbeiroVisualizado(event.target.value)}
                style={{
                  ...quickInputStyle,
                  width: 'auto',
                  minWidth: 180
                }}
              >
                <option value="all">Todas as agendas</option>
                {opcoesBarbeirosAgenda.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.name}{barber.active === false ? ' (histórico)' : ''}
                  </option>
                ))}
              </select>
            )}

            <div className="admin-agenda-view-buttons">
            <button
              type="button"
              onClick={() => setModoAgenda('calendario')}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #c5a46d',
                background: modoAgenda === 'calendario' ? '#c5a46d' : '#242424',
                color: modoAgenda === 'calendario' ? '#171717' : '#ddd',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Calendário
            </button>
            <button
              type="button"
              onClick={() => setModoAgenda('lista')}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #444',
                background: modoAgenda === 'lista' ? '#c5a46d' : '#242424',
                color: modoAgenda === 'lista' ? '#171717' : '#ddd',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Lista
            </button>
            </div>
          </div>
        </div>

        {modoAgenda === 'calendario' && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => deslocarDataCalendario(-1)}
                  aria-label="Dia anterior"
                  className="admin-calendar-step"
                  style={{ padding: '9px 13px' }}
                >
                  ‹
                </button>
                <strong className="admin-calendar-day-label">
                  {dataCalendario === hoje
                    ? 'HOJE'
                    : new Date(
                        ...dataCalendario.split('-').map(Number).map((valor, indice) => indice === 1 ? valor - 1 : valor),
                        12
                      ).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase()}
                </strong>
                <button
                  type="button"
                  onClick={() => deslocarDataCalendario(1)}
                  aria-label="Próximo dia"
                  className="admin-calendar-step"
                  style={{ padding: '9px 13px' }}
                >
                  ›
                </button>
              </div>

              <div className="admin-calendar-date-controls">
                <input
                  type="date"
                  value={dataCalendario}
                  onChange={(event) => setDataCalendario(event.target.value)}
                  style={{ ...quickInputStyle, width: 'auto' }}
                  aria-label="Escolher data do calendário"
                />
                {dataCalendario !== hoje && (
                  <button
                    type="button"
                    className="admin-calendar-today-button"
                    onClick={() => setDataCalendario(hoje)}
                    aria-label="Voltar para hoje"
                    title="Voltar para hoje"
                  >
                    <span aria-hidden="true">↶</span>
                    Hoje
                  </button>
                )}
              </div>

              <strong style={{ color: '#c5a46d', textTransform: 'capitalize' }}>
                {textoDataCalendario(dataCalendario)}
              </strong>
            </div>

            {barbeirosAgenda.length === 0 ? (
              <p style={{ color: '#999', padding: 15 }}>
                Nenhum barbeiro disponível para exibir neste calendário.
              </p>
            ) : (
              <MobileBarberCalendar
                enabled={profile.role === 'admin' && barbeiroVisualizado === 'all'}
                barbers={barbeirosAgenda}
                selectedId={mobileBarberId}
                setSelectedId={setMobileBarberId}
                renderBarber={(barber) => {
                  const agendamentosBarbeiro = agendamentosDoDia
                    .filter((appointment) => pertenceAoBarbeiro(appointment, barber.id) ||
                      (!appointment.barber_id && appointment.barber_name === barber.name))
                    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())

                  const disponibilidade = barber.active === false ? null : disponibilidadeCalendario[barber.id]
                  const todosHorarios = disponibilidade?.todosHorarios || []
                  const bloqueiosBarbeiro = bloqueiosCalendario[barber.id] || []
                  const eventos = [
                    ...agendamentosBarbeiro.map((appointment) => ({
                      tipo: 'ocupado',
                      horario: somenteHorario(appointment.starts_at),
                      appointment,
                      ordem: minutosDoDia(appointment.starts_at)
                    })),
                    ...todosHorarios.map((item) => {
                      const [hora, minuto] = item.horario.split(':').map(Number)
                      const ordem = hora * 60 + minuto
                      const horarioJaPassou = dataCalendario < hoje ||
                        (dataCalendario === hoje && ordem <= minutosAgora)
                      const temAgendamentoNoIntervalo = agendamentosBarbeiro.some((appointment) => {
                        const inicio = minutosDoDia(appointment.starts_at)
                        const fim = appointment.ends_at
                          ? minutosDoDia(appointment.ends_at)
                          : inicio + duracaoAgendamento(appointment)
                        return ordem >= inicio && ordem < fim
                      })

                      return {
                        tipo: horarioJaPassou && !temAgendamentoNoIntervalo
                          ? 'passado'
                          : temAgendamentoNoIntervalo ? 'indisponivel'
                          : bloqueiosBarbeiro.includes(item.horario) ? 'bloqueado'
                          : item.disponivel ? 'livre' : 'indisponivel',
                        horario: item.horario,
                        ordem
                      }
                    }).filter((evento) => ['livre', 'passado', 'bloqueado'].includes(evento.tipo))
                  ].sort((a, b) => a.ordem - b.ordem || (a.tipo === 'ocupado' ? -1 : 1))

                  return (
                    <>
                      <header className="admin-calendar-barber-heading">
                        <strong>{barber.name}</strong>
                        <span>{barber.active === false ? 'Histórico · ' : ''}{agendamentosBarbeiro.length} {agendamentosBarbeiro.length === 1 ? 'marcado' : 'marcados'}</span>
                      </header>

                      {carregandoDisponibilidade && eventos.length === 0 ? (
                        <p className="admin-calendar-empty">Consultando horários…</p>
                      ) : eventos.length === 0 ? (
                        <p className="admin-calendar-empty">Nenhum horário disponível ou agendado.</p>
                      ) : (
                        <div className="admin-calendar-events">
                          {eventos.map((evento, index) => evento.tipo === 'ocupado' ? (
                            <article
                              className={`admin-calendar-event is-booked ${evento.appointment.completed_at ? 'is-completed' : ''} ${attendanceLoading === evento.appointment.id || cancelLoading === evento.appointment.id ? 'is-action-loading' : ''} ${swipeVisual?.appointmentId === evento.appointment.id ? `is-swiping ${swipeVisual.direction}` : ''}`}
                              key={`booked-${evento.appointment.id}`}
                              style={swipeVisual?.appointmentId === evento.appointment.id ? {
                                transform: `translateX(${swipeVisual.delta}px)`,
                                backgroundColor: swipeVisual.delta > 0
                                  ? `rgba(34, 160, 107, ${Math.min(0.42, Math.abs(swipeVisual.delta) / 300)})`
                                  : swipeVisual.delta < 0
                                    ? `rgba(190, 55, 55, ${Math.min(0.42, Math.abs(swipeVisual.delta) / 300)})`
                                    : undefined,
                                transition: swipeVisual.dragging ? 'none' : 'transform 180ms ease, background-color 180ms ease'
                              } : undefined}
                              onPointerDown={(event) => iniciarSwipeAgendamento(event, evento.appointment)}
                              onPointerMove={(event) => moverSwipeAgendamento(event, evento.appointment)}
                              onPointerUp={(event) => finalizarSwipeAgendamento(event, evento.appointment)}
                              onPointerCancel={() => { swipeStartRef.current = null; setSwipeVisual(null) }}
                              title="Arraste para a direita para confirmar o corte realizado ou para a esquerda para cancelar"
                            >
                              {swipeVisual?.appointmentId === evento.appointment.id && swipeVisual.direction && (
                                <span className={`admin-swipe-feedback ${swipeVisual.direction}`}>
                                  {swipeVisual.direction === 'complete' ? '✓ REALIZADO' : '✕ CANCELAR'}
                                </span>
                              )}
                              <time>{evento.horario}</time>
                              <div className="admin-calendar-event-info">
                                <strong>{evento.appointment.customer_name}</strong>
                                <span>
                                  {(evento.appointment.items || []).filter((item) => item.active !== false).map((item) => item.service_name).filter(Boolean).join(' + ') || 'Serviço não informado'}
                                </span>
                                <small>
                                  {evento.appointment.ends_at
                                    ? `${evento.horario} – ${somenteHorario(evento.appointment.ends_at)}`
                                    : `Duração: ${duracaoAgendamento(evento.appointment)} min`}
                                  {attendanceLoading === evento.appointment.id
                                    ? ' · Atualizando…'
                                    : evento.appointment.completed_at
                                      ? ' · Corte realizado'
                                      : ' · Deslize → realizado | ← cancelar'}
                                </small>
                              </div>
                              <span className="admin-calendar-event-status">
                                {attendanceLoading === evento.appointment.id
                                  ? 'Salvando'
                                  : evento.appointment.completed_at ? 'Realizado' : 'Ocupado'}
                              </span>
                            </article>
                          ) : evento.tipo === 'passado' ? (
                            <article className="admin-calendar-event is-past" key={`past-${barber.id}-${evento.horario}-${index}`}>
                              <time>{evento.horario}</time>
                              <div className="admin-calendar-event-info">
                                <strong>Horário encerrado</strong>
                                <span>Não foi ocupado e já passou</span>
                              </div>
                              <span className="admin-calendar-event-status">Passou</span>
                              <button
                                type="button"
                                className="admin-calendar-add-past-button"
                                onClick={() => abrirAgendamentoNoHorario(barber.id, dataCalendario, evento.horario)}
                                title={`Adicionar cliente às ${evento.horario}`}
                              >
                                + Adicionar cliente
                              </button>
                            </article>
                          ) : (
                            <div
                              className={`admin-calendar-event ${evento.tipo === 'bloqueado' ? 'is-blocked' : 'is-free'}`}
                              key={`slot-${barber.id}-${evento.horario}-${index}`}
                              role={evento.tipo === 'bloqueado' ? 'button' : undefined}
                              tabIndex={evento.tipo === 'bloqueado' ? 0 : undefined}
                              onClick={() => {
                                const chave = `${barber.id}-${evento.horario}`
                                if (slotSwipeSuprimirClickRef.current === chave) {
                                  slotSwipeSuprimirClickRef.current = ''
                                  return
                                }
                                if (evento.tipo === 'bloqueado' && !bloqueioEmAndamento) {
                                  abrirAgendamentoNoHorario(barber.id, dataCalendario, evento.horario)
                                }
                              }}
                              onKeyDown={(event) => {
                                if (evento.tipo === 'bloqueado' && (event.key === 'Enter' || event.key === ' ')) {
                                  event.preventDefault()
                                  abrirAgendamentoNoHorario(barber.id, dataCalendario, evento.horario)
                                }
                              }}
                              onPointerDown={(event) => iniciarSwipeSlot(event, barber.id, evento.horario, evento.tipo === 'bloqueado')}
                              onPointerMove={(event) => moverSwipeSlot(event, barber.id, evento.horario)}
                              onPointerUp={(event) => finalizarSwipeSlot(event, barber.id, evento.horario)}
                              onPointerCancel={() => { slotSwipeRef.current = null; setSlotSwipeVisual(null) }}
                              title={evento.tipo === 'bloqueado'
                                ? 'Toque para agendar manualmente ou arraste para a direita para liberar'
                                : 'Arraste para a esquerda para bloquear'}
                              style={{
                                touchAction: 'pan-y',
                                cursor: evento.tipo === 'bloqueado' ? 'pointer' : 'grab',
                                ...(evento.tipo === 'bloqueado' ? { border: '1px solid #956d36', background: '#30271c' } : {}),
                                ...(slotSwipeVisual?.chave === `${barber.id}-${evento.horario}`
                                  ? { transform: `translateX(${slotSwipeVisual.delta}px)`, transition: 'none' }
                                  : {})
                              }}
                            >
                              <time>{evento.horario}</time>
                              <div className="admin-calendar-event-info">
                                <strong>{evento.tipo === 'bloqueado' ? 'Horário bloqueado' : 'Horário livre'}</strong>
                                <span>{bloqueioEmAndamento === `${barber.id}-${evento.horario}`
                                  ? 'Atualizando…'
                                  : evento.tipo === 'bloqueado'
                                    ? 'Toque para agendar · deslize → liberar'
                                    : 'Disponível por 35 minutos · deslize ← bloquear'}</span>
                              </div>
                              <span className="admin-calendar-event-status" style={evento.tipo === 'bloqueado' ? { color: '#e5b878' } : undefined}>
                                {evento.tipo === 'bloqueado' ? 'Bloqueado' : 'Livre'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {disponibilidade?.error && (
                        <p className="admin-calendar-warning">Não foi possível carregar os horários livres. Os agendamentos confirmados continuam visíveis.</p>
                      )}
                    </>
                  )
                }}
              />
            )}

          </>
        )}
      </section>

      {/* AGENDAMENTOS CONFIRMADOS */}
      {modoAgenda === 'lista' && (
      <>
      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 18
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>
              Agendamentos confirmados
            </h2>

            <p style={{ color: '#aaa', margin: '6px 0 0', fontSize: 13 }}>
              {agendamentosConfirmados.length} horário(s) confirmado(s)
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 9,
              flexWrap: 'wrap'
            }}
          >
            <button
              type="button"
              onClick={abrirAgendamentoRapido}
              style={{
                padding: '11px 15px',
                border: '1px solid #c5a46d',
                borderRadius: 8,
                background: '#c5a46d',
                color: '#171717',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              + Agendamento rápido
            </button>

            <button
              type="button"
              onClick={atualizarAgenda}
            >
              Atualizar agenda
            </button>
          </div>
        </div>

        {agendamentosConfirmados.length === 0 ? (
          <div
            style={{
              background: '#1d1d1d',
              border: '1px solid #333',
              borderRadius: 12,
              padding: 22,
              color: '#aaa'
            }}
          >
            Nenhum agendamento confirmado no momento.
          </div>
        ) : (
          renderizarGrupos(gruposConfirmados)
        )}
      </section>

      {/* AGENDAMENTOS CANCELADOS */}
      <section
        style={{
          marginTop: 35,
          borderTop: '1px solid #333',
          paddingTop: 20
        }}
      >
        <details>
          <summary
            style={{
              cursor: 'pointer',
              color: '#999',
              fontSize: 14,
              padding: '10px 0',
              userSelect: 'none'
            }}
          >
            Agendamentos cancelados ({agendamentosCancelados.length}) — ver histórico
          </summary>

          <div style={{ marginTop: 15 }}>
            {agendamentosCancelados.length === 0 ? (
              <p style={{ color: '#777', fontSize: 13 }}>
                Nenhum agendamento cancelado dentro do período de exibição.
              </p>
            ) : (
              renderizarGrupos(gruposCancelados, true)
            )}
          </div>
        </details>
      </section>
      </>
      )}
      </div>
      )}

      {activeSection === 'financeiro' && (
      <section className="admin-finance-section" data-admin-section="financeiro">
        <div className="admin-finance-heading">
          <div>
            <span>FECHAMENTO FINANCEIRO</span>
            <h1>Financeiro</h1>
            <h2>Resumo de {textoDataCalendario(selectedFinanceDate)}</h2>
            <p>Somente serviços ativos de agendamentos marcados como realizados.</p>
          </div>
          <label className="admin-finance-period">
            Data do financeiro
            <input type="date" value={selectedFinanceDate} onChange={(event) => setFinanceDate(event.target.value)} />
          </label>
          <span className="admin-finance-refresh">
            {financeLoading ? 'Atualizando…' : 'Valores atualizados'}
          </span>
        </div>

        {financeLoading && financeData.length === 0 ? (
          <p className="admin-finance-empty">Carregando valores…</p>
        ) : financeData.length === 0 ? (
          <p className="admin-finance-empty">Nenhum valor financeiro disponível para esta data.</p>
        ) : (
          <div className="admin-finance-grid">
            {financeData
              .filter((item) => profile.role === 'admin' || item.barber_id === profile.barber_id)
              .map((item) => (
                <article className="admin-finance-card" key={item.barber_id}>
                  <h3>{item.barber_name}</h3>
                  <div className="admin-finance-main-value">
                    <span>Faturamento do dia</span>
                    <strong>{moeda(item.total_dia)}</strong>
                    {atendimentosDoFinanceiro.has(item.barber_id) && (
                      <small>{atendimentosDoFinanceiro.get(item.barber_id)} realizado(s) na agenda</small>
                    )}
                  </div>
                  <div className="admin-finance-splits">
                    <div>
                      <span>Barbeiro · 50%</span>
                      <strong>{moeda(Number(item.total_dia || 0) * 0.5)}</strong>
                    </div>
                    <div>
                      <span>Barbearia · 50%</span>
                      <strong>{moeda(Number(item.total_dia || 0) * 0.5)}</strong>
                    </div>
                  </div>
                  {dataSelecionadaEhSabado && (
                    <div className="admin-finance-weekly">
                      <span>Acumulado da semana · segunda a sábado</span>
                      <strong>{moeda(item.total_semana)}</strong>
                    </div>
                  )}
                </article>
              ))}
          </div>
        )}
        {dataSelecionadaEhSabado && (
          <p className="admin-finance-note">
            O faturamento do dia considera somente este sábado. O acumulado semanal soma os cortes realizados de segunda-feira até sábado, sem misturar os dois valores.
          </p>
        )}
      </section>
      )}

      {['equipe', 'servicos'].includes(activeSection) && (
        <section className="admin-workspace-panel" data-admin-section={activeSection}>
          <h1>{activeSection === 'equipe' ? 'Equipe' : 'Serviços'}</h1>
          <Suspense fallback={<p role="status">Carregando…</p>}>
            {contactTarget && activeSection === 'equipe' ? (
              <BarberProfileEditor key={contactTarget} profile={profile} targetId={contactTarget} onClose={() => setContactTarget('')} onChange={atualizarAposAlterarContato} />
            ) : canManageCatalog ? (
              <CatalogManagement
                key={activeSection}
                kind={activeSection === 'equipe' ? 'barber' : 'service'}
                onChange={atualizarAposAlterarCatalogo}
                onDenied={negarAcessoCatalogo}
                canEditContact={(id) => editableTeam.some((record) => record.id === id)}
                onEditContact={setContactTarget}
              />
            ) : (
              <ul className="admin-team-list">
                {editableTeam.map((record) => (
                  <li key={record.id}>
                    <div className="admin-record-identity">
                      {record.photo_url ? <img src={record.photo_url} alt="" /> : <span className="admin-record-avatar" aria-hidden="true">{record.name.charAt(0)}</span>}
                      <strong>{record.name}</strong>
                      <span className="admin-record-status" data-active={record.active}>{record.active ? 'Ativo' : 'Inativo'}</span>
                    </div>
                    <button type="button" onClick={() => setContactTarget(record.id)}>Foto e contato</button>
                  </li>
                ))}
              </ul>
            )}
          </Suspense>
        </section>
      )}

      {activeSection === 'configuracoes' && (
        <section className="admin-workspace-panel" data-admin-section="configuracoes">
          <h1>Configurações</h1>
          <div className="admin-settings-grid">
            <section><h2>Dados da barbearia</h2><p>MR.SALOUM Barbearia</p></section>
            <section><h2>Meu perfil</h2><p>{nomePerfil}</p></section>
            <section>
              <h2>Configurações individuais</h2>
              {profile.role === 'barber' ? (
                <Suspense fallback={<p role="status">Carregando…</p>}>
                  <BarberProfileEditor profile={profile} onChange={atualizarAposAlterarContato} />
                </Suspense>
              ) : editableTeam.length > 0 && (
                <button type="button" onClick={() => setSection('equipe')}>Ver contatos da equipe</button>
              )}
            </section>
            <section>
              <h2>Horários de atendimento</h2>
              <button type="button" onClick={() => setSection('agenda')}>Abrir agenda e bloqueios</button>
            </section>
            <section><h2>Notificações</h2><p>As preferências de notificações são administradas fora deste painel.</p></section>
            <section><h2>Acesso e segurança</h2><p>{profile.role === 'admin' ? 'Conta administrativa' : 'Acesso à própria agenda e ao próprio financeiro.'}</p></section>
          </div>
        </section>
      )}

      {activeSection === 'agenda' && (
      <button
        type="button"
        onClick={abrirAgendamentoRapido}
        aria-label="Criar agendamento presencial"
        style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 100,
          border: '1px solid #e0c28d',
          borderRadius: 999,
          padding: '15px 20px',
          background: '#c5a46d',
          color: '#171717',
          fontWeight: 800,
          boxShadow: '0 8px 28px rgba(0,0,0,.4)',
          cursor: 'pointer'
        }}
      >
        + Novo agendamento
      </button>
      )}
      </div>
      </div>
    </main>
  )
}

// Estilo dos campos do modal de agendamento rápido
const quickInputStyle = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '12px 13px',
  borderRadius: 8,
  border: '1px solid #444',
  background: '#242424',
  color: '#f5f5f5',
  fontSize: 14,
  outline: 'none'
}
