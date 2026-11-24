# Homologação concorrente do Mr.Saloum

## Ambiente e execução

Usar um PostgreSQL descartável com a cadeia SQL real aplicada, incluindo as roles e a semântica de `auth.uid()` do Supabase. Criar as contas e os dados do teste do zero. Isolar a rede da instância e manter dispatchers, jobs e saídas HTTP de notificações desligados antes de criar qualquer fixture. O ambiente deve aceitar escrita de catálogo para o administrador principal **local**. Registre essa condição só no clone. O executor abre conexões apenas em `127.0.0.1`, exige um nome de banco específico e confere um marcador antes de fazer escritas. Não usar tunelamento, port forwarding para ambientes remotos, credenciais de produção ou uma cópia com dados de clientes.

1. Disponibilizar `psql` no PATH e o banco `mr_saloum_concorrencia_teste` na porta local escolhida. Usar um usuário local com capacidade de preparar os dados, trocar para `authenticated` e consultar `pg_stat_activity` e `pg_locks`. Para autenticação, aponte `PGPASSWORD` para a credencial descartável por um mecanismo local.
2. No banco descartável, criar o marcador com `CREATE TABLE public.homologacao_descartavel (marker text NOT NULL);` e `INSERT INTO public.homologacao_descartavel VALUES ('MR_SALOUM_SINTETICO');`
3. Preparar o manifesto e os SQLs de fixture abaixo, usando as colunas reais da cadeia SQL instalada. Setups e verificadores são arquivos de entrada locais e confiáveis. Manter a pasta de fixtures fora do índice.
4. Executar `node tests/postgres/concorrencia.mjs .\fixtures.local\manifest.json mr_saloum_concorrencia_teste 55432 usuario_local`. Para cada cenário o executor reinicializa a fixture e roda três ordens, mantendo A aberta enquanto B inicia, mantendo B aberta enquanto A inicia e liberando as duas por uma barreira comum. São **21 rodadas**. Para investigar interleavings raros, repetir o comando com os mesmos dados e registrar a saída.

## Manifesto

O JSON tem uma chave para cada cenário da tabela. Cada chave contém `setup`, `verify`, `input`, `expected` e, opcionalmente, `mustBlock`. Nos três primeiros objetos, `default` vale para todos os modos e `a`, `b` ou `junto` substituem o padrão. Os caminhos são relativos ao manifesto. O setup é executado em uma sessão nova antes de **cada** rodada. Deve limpar só sua fixture ou usar IDs distintos por rodada, preparar as contas, horários, disponibilidades e versões iniciais e guardar os snapshots necessários para verificar rollback, preservação de itens e vínculo. Não fazer a operação de teste no setup.

```json
{
  "mesma_versao": {
    "setup": { "default": "mesma_versao.setup.sql" },
    "verify": { "default": "mesma_versao.verify.sql" },
    "input": { "default": {
      "customer": "00000000-0000-4000-8000-000000000001",
      "secondCustomer": "00000000-0000-4000-8000-000000000002",
      "admin": "00000000-0000-4000-8000-000000000003",
      "barberUser": "00000000-0000-4000-8000-000000000004",
      "barber": "00000000-0000-4000-8000-000000000005",
      "service": "00000000-0000-4000-8000-000000000006",
      "secondService": "00000000-0000-4000-8000-000000000007",
      "date": "2027-01-04",
      "time": "10:00",
      "barberVersion": "VERSAO_DA_FIXTURE",
      "serviceVersion": "VERSAO_DA_FIXTURE",
      "profileVersion": "VERSAO_DA_FIXTURE",
      "serviceEditA": { "name": "Serviço sintético A", "price": 31, "slot_units": 1 },
      "serviceEditB": { "name": "Serviço sintético B", "price": 32, "slot_units": 1 }
    }},
    "expected": {
      "a": [["00000", "MS004"]],
      "b": [["MS004", "00000"]],
      "junto": [["00000", "MS004"], ["MS004", "00000"]]
    },
    "mustBlock": ["a", "b"]
  }
}
```

Completar as sete entradas com os campos de exemplo. Ajustar a data para um horário elegível pelas regras instaladas e usar versões reais da fixture. Os objetos de edição devem conter todos os campos exigidos pela versão SQL testada. O cliente de A deve ser o mesmo perfil que B tenta converter no cenário de conversão. A sessão de barbeiro deve estar vinculada ao barbeiro sintético. Em `expected`, especificar os pares de SQLSTATEs **na ordem [A, B]**, segundo a política da migração revisada. Use `00000` para sucesso. Para os códigos de negócio específicos da implementação, consulte as funções do clone antes de montar a matriz. Não aceite qualquer erro como sucesso. A matriz não deve aceitar `40P01`, `55P03` ou `57014`.

O verificador recebe `:'mode'`, `:'state_a'` e `:'state_b'` como variáveis do psql e deve emitir uma única linha booleana, `t` quando todos os invariantes forem verdadeiros. Use comparações com snapshots do setup e IDs explícitos nas consultas. Verifique o resultado de cada operação que teve sucesso e ausência de efeitos parciais das transações rejeitadas. Para uma rejeição, não basta verificar o SQLSTATE.

## Operações e invariantes por cenário

| Chave | A / B | Verificação após finalizar as sessões |
| --- | --- | --- |
| `conversao` | Reserva pública / criação de barbeiro vinculada ao mesmo perfil | Quando a reserva vencer, ela permanece íntegra e a conversão deve respeitar a regra de inelegibilidade do cliente com reserva. Quando a conversão vencer, validar a elegibilidade reavaliada da reserva. Não podem sobrar perfil convertido parcialmente, barbeiro órfão ou itens sem reserva. Compare vínculo, role e itens com o snapshot. |
| `desativa_barbeiro` | Reserva pública / desativação do barbeiro alvo | Se a reserva vencer, preservá-la e exigir rejeição da desativação com `MS001`. Se a desativação vencer, a nova reserva deve ser rejeitada. Nenhuma reserva anterior é cancelada. |
| `desativa_servico` | Reserva pública / desativação do serviço solicitado | Serviço desativado primeiro impede a nova reserva. Se a reserva vencer antes da desativação, seus itens permanecem íntegros com nome, preço e duração registrados, ainda que o serviço seja desativado depois. |
| `mesmo_horario` | Duas reservas de clientes distintos para o mesmo barbeiro e horário, com os dois serviços em ordem inversa | Exatamente uma reserva nova. Somente os itens da vencedora são persistidos. O segundo cliente recebe o conflito esperado pela regra de disponibilidade. |
| `mesma_versao` | Duas edições de serviço com o mesmo token | Exatamente uma atualização e uma rejeição `MS004`. Conferir nova versão, campos completos da vencedora e que os valores de itens antigos continuam iguais. |
| `perfil_desativa` | Edição própria de foto/contato / desativação do barbeiro | Conferir o resultado permitido para cada ordem conforme a política de edição de perfil inativo. A desativação não pode sobrescrever foto ou contato gravados pela outra operação. Conflitos de versão devem preservar integralmente os valores vencedores. Identidade, vínculos e atendimento histórico não mudam. |
| `bloqueio_desativa` | Bloqueio de horário pelo barbeiro / desativação do barbeiro | Depois de desativado, o barbeiro não deve ganhar um novo bloqueio através de validação obsoleta. Quando o bloqueio vier primeiro, conferir a política instalada de preservação do bloqueio ou rejeição da desativação. Nenhum agendamento existente pode ser alterado. |

## Ordem de locks e critérios de entrega

- No clone, revisar `pg_get_functiondef(oid)` das RPCs de escrita envolvidas, de `lock_active_booking_resources` e das funções dos gatilhos por `pg_trigger.tgfoid`. Onde aplicável, verificar uma ordem consistente para perfil, barbeiro e serviços, incluindo a ordenação de múltiplos IDs. Comparar os caminhos de reserva, conversão, catálogo, perfil e bloqueio. Não inferir a ordem apenas pelo instante final de uma captura.
- Em cada direção serial, a saída indica se `pg_blocking_pids` observou espera e lista os locks quando observados. Preencher `mustBlock` para as direções em que as operações devem compartilhar um bloqueio. Na rodada conjunta, a barreira faz ambas as sessões iniciarem juntas, com limite de espera e erro explícito para deadlock ou timeout.
- Registrar SQLSTATEs, locks observados, estado final e número de iterações. Mesmo com todas as rodadas verdes, a ausência observada de deadlock complementa a inspeção da ordem de aquisição. Os testes não foram executados nesta entrega porque não havia Postgres descartável acessível nem as migrações e fixtures instaladas no checkout.
