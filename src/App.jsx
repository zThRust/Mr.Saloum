import './App.css'
import BrandLogo from './BrandLogo'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { calcularDuracaoSlots, totalItensRegistrados } from './bookingValues'
import { useUpdateBlock } from './pwaUpdate'

const AdminPage = lazy(() => import('./AdminApp'))

function ClienteApp() {
  const [barbers, setBarbers] = useState([])
  const [services, setServices] = useState([])
  const [selectedServiceIds, setSelectedServiceIds] = useState([])
  const [selectedBarberId, setSelectedBarberId] = useState('')
  const selectedBarber = barbers.find(({ id }) => id === selectedBarberId) ?? null
  const activeBarberId = selectedBarber?.id
  const selectedServices = selectedServiceIds.map((id) => services.find((service) => service.id === id)).filter(Boolean)
  const selectedServiceCount = selectedServices.length
  const [bookingDetails, setBookingDetails] = useState(null)
  const [horaAtual, setHoraAtual] = useState(new Date())

  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')

  const [weekOffset, setWeekOffset] = useState(0)
  const [availableTimes, setAvailableTimes] = useState([])
  const [loadingTimes, setLoadingTimes] = useState(false)
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0)

  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authSubmitting, setAuthSubmitting] = useState(false)

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [authError, setAuthError] = useState('')

  const [profileOpen, setProfileOpen] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')

  const [bookingsOpen, setBookingsOpen] = useState(false)
  const [myBookings, setMyBookings] = useState([])
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [bookingsError, setBookingsError] = useState('')
  const [bookingsMessage, setBookingsMessage] = useState('')
  const [cancelLoading, setCancelLoading] = useState('')

  const [bookingSubmitting, setBookingSubmitting] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [bookingSuccess, setBookingSuccess] = useState('')
  const [bookingId, setBookingId] = useState(null)
  useUpdateBlock(Boolean(authSubmitting || profileOpen || profileSaving || cancelLoading || bookingSubmitting ||
    (!user && (customerName || customerPhone)) || (!bookingSuccess && (selectedServiceCount || selectedDate))))

  // Instalação opcional do PWA (sem modificar o banco).
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [installKnown, setInstallKnown] = useState(false)
  const [standalone, setStandalone] = useState(false)
  const [iosDevice, setIosDevice] = useState(false)

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    setStandalone(isStandalone)
    setIosDevice(isIOS)
    setInstallKnown(localStorage.getItem('mrsaloum-pwa-installed') === 'yes')

    function onBeforeInstallPrompt(event) {
      event.preventDefault()
      setInstallPrompt(event)
    }
    function onAppInstalled() {
      localStorage.setItem('mrsaloum-pwa-installed', 'yes')
      setInstallKnown(true)
      setInstallOpen(false)
      setInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const podeConvidarInstalacao = !standalone && !installKnown
  function convidarInstalacao() {
    if (podeConvidarInstalacao) setInstallOpen(true)
  }

  async function instalarAplicativo() {
    if (installPrompt) {
      const prompt = installPrompt
      setInstallPrompt(null)
      try {
        await prompt.prompt()
        const escolha = await prompt.userChoice
        if (escolha?.outcome === 'accepted') setInstallOpen(false)
      } catch (error) {
        console.warn('Não foi possível abrir a instalação:', error)
      }
    } else if (!iosDevice) {
      // Sem evento de instalação disponível: orientar instalação manual.
      setInstallOpen(true)
    }
  }

  function limparMensagensAgendamento() {
    setBookingError('')
    setBookingSuccess('')
    setBookingId(null)
    setBookingDetails(null)
  }

  useEffect(() => {
    if (!installOpen) return
    const onKey = (event) => { if (event.key === 'Escape') setInstallOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [installOpen])

  useEffect(() => {
    const modalAberto = profileOpen || bookingsOpen

    if (!modalAberto) return

    function fecharComEsc(event) {
      if (event.key === 'Escape') {
        setProfileOpen(false)
        setBookingsOpen(false)
      }
    }

    document.addEventListener('keydown', fecharComEsc)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', fecharComEsc)
      document.body.style.overflow = ''
    }
  }, [profileOpen, bookingsOpen])

  function formatarDataHora(valor) {
    if (!valor) return 'Horário não informado'

    return new Date(valor).toLocaleString('pt-BR', {
      timeZone: 'America/Fortaleza',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  function formatarHorario(valor) {
    if (!valor) return 'Horário não informado'

    return new Date(valor).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Fortaleza',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  function formatarValor(valor) {
    return Number(valor || 0).toFixed(2).replace('.', ',')
  }

  async function carregarAgendamentos() {
    if (!user) {
      setMyBookings([])
      return
    }

    setBookingsLoading(true)
    setBookingsError('')

    const { data, error } = await supabase.rpc('meus_agendamentos')

    if (error) {
      console.error('Erro ao buscar agendamentos:', error)
      setBookingsError('Não foi possível carregar seus agendamentos.')
      setMyBookings([])
    } else {
      setMyBookings(Array.isArray(data) ? data : [])
    }

    setBookingsLoading(false)
  }

  function alternarMeusAgendamentos() {
    if (!bookingsOpen) {
      setProfileOpen(false)
      setBookingsOpen(true)
      carregarAgendamentos()
    } else {
      setBookingsOpen(false)
    }
  }

  async function cancelarServico(item) {
    const confirmado = window.confirm(
      `Deseja cancelar somente o serviço "${item.service_name}"?`
    )

    if (!confirmado) return

    setCancelLoading(item.id)
    setBookingsError('')
    setBookingsMessage('')

    const { error } = await supabase.rpc(
      'cancelar_servico_agendamento',
      {
        p_appointment_item_id: item.id
      }
    )

    if (error) {
      console.error('Erro ao cancelar serviço:', error)
      setBookingsError(error.message || 'Não foi possível cancelar o serviço.')
    } else {
      setBookingsMessage(
        `O serviço "${item.service_name}" foi cancelado.`
      )

      await carregarAgendamentos()
      setAvailabilityRefresh((valor) => valor + 1)
    }

    setCancelLoading('')
  }

  async function cancelarAgendamento(appointment) {
    const confirmado = window.confirm(
      'Tem certeza de que deseja cancelar todos os serviços deste agendamento?'
    )

    if (!confirmado) return

    setCancelLoading(appointment.id)
    setBookingsError('')
    setBookingsMessage('')

    const { error } = await supabase.rpc(
      'cancelar_agendamento',
      {
        p_appointment_id: appointment.id
      }
    )

    if (error) {
      console.error('Erro ao cancelar agendamento:', error)
      setBookingsError(
        error.message || 'Não foi possível cancelar o agendamento.'
      )
    } else {
      setBookingsMessage('Agendamento cancelado com sucesso.')

      await carregarAgendamentos()
      setAvailabilityRefresh((valor) => valor + 1)
    }

    setCancelLoading('')
  }

  useEffect(() => {
    const intervalo = setInterval(() => {
      setHoraAtual(new Date())
    }, 30000)

    return () => clearInterval(intervalo)
  }, [])

  function carregarDadosCliente(cliente) {
    setCustomerName(cliente?.user_metadata?.full_name || '')
    setCustomerPhone(cliente?.user_metadata?.phone || '')
  }

  useEffect(() => {
    let ativo = true

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (ativo) {
        const cliente = session?.user ?? null
        setUser(cliente)
        carregarDadosCliente(cliente)
        setAuthLoading(false)
      }
    })

    async function verificarSessao() {
      const { data, error } = await supabase.auth.getSession()

      if (!ativo) return

      if (error) {
        setAuthError(error.message)
      }

      const cliente = data.session?.user ?? null
      setUser(cliente)
      carregarDadosCliente(cliente)
      setAuthLoading(false)
    }

    verificarSessao()

    return () => {
      ativo = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (user) {
      carregarAgendamentos()
    } else {
      setMyBookings([])
    }
  }, [user])

  async function entrarComoCliente(event) {
    event.preventDefault()

    setAuthError('')

    const nome = customerName.trim()
    const telefone = customerPhone.replace(/\D/g, '')

    if (nome.length < 3) {
      setAuthError('Digite seu nome completo.')
      return
    }

    if (telefone.length !== 10 && telefone.length !== 11) {
      setAuthError('Digite um telefone válido com DDD.')
      return
    }

    setAuthSubmitting(true)

    const { data, error } = await supabase.auth.signInAnonymously({
      options: {
        data: {
          full_name: nome,
          phone: telefone
        }
      }
    })

    if (error) {
      setAuthError(error.message)
    } else {
      setUser(data.user)
      carregarDadosCliente(data.user)
      convidarInstalacao()
    }

    setAuthSubmitting(false)
  }

  async function salvarDadosCliente(event) {
    event.preventDefault()

    setProfileError('')
    setProfileSuccess('')

    const nome = customerName.trim()
    const telefone = customerPhone.replace(/\D/g, '')

    if (nome.length < 3) {
      setProfileError('Digite um nome válido.')
      return
    }

    if (telefone.length !== 10 && telefone.length !== 11) {
      setProfileError('Digite um telefone válido com DDD.')
      return
    }

    setProfileSaving(true)

    const { data, error } = await supabase.auth.updateUser({
      data: {
        full_name: nome,
        phone: telefone
      }
    })

    if (error) {
      setProfileError('Não foi possível salvar os dados. Tente novamente.')
      console.error('Erro ao atualizar cadastro:', error.message)
    } else {
      setUser(data.user)
      carregarDadosCliente(data.user)
      setProfileSuccess('Seus dados foram atualizados com sucesso!')
    }

    setProfileSaving(false)
  }

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const segundaAtual = new Date(hoje)
  const diaSemana = hoje.getDay()
  const diferencaSegunda = diaSemana === 0 ? -6 : 1 - diaSemana

  segundaAtual.setDate(hoje.getDate() + diferencaSegunda)

  const inicioSemana = new Date(segundaAtual)
  inicioSemana.setDate(inicioSemana.getDate() + weekOffset * 7)

  const diasDisponiveis = Array.from({ length: 6 }, (_, index) => {
    const data = new Date(inicioSemana)
    data.setDate(inicioSemana.getDate() + index)
    return data
  })

  const dataMaxima = new Date(segundaAtual)
  dataMaxima.setDate(segundaAtual.getDate() + 12)

  function formatarDataLocal(data) {
    const ano = data.getFullYear()
    const mes = String(data.getMonth() + 1).padStart(2, '0')
    const dia = String(data.getDate()).padStart(2, '0')

    return `${ano}-${mes}-${dia}`
  }

  const dataAtualString = formatarDataLocal(horaAtual)
  const horarioAtualString = `${String(horaAtual.getHours()).padStart(2, '0')}:${String(horaAtual.getMinutes()).padStart(2, '0')}`

  const horariosExibidos =
    selectedDate === dataAtualString
      ? availableTimes.filter((horario) => horario > horarioAtualString)
      : availableTimes

  function selecionarServico(service) {
    if (!selectedBarber) return
    limparMensagensAgendamento()

    setSelectedServiceIds((ids) =>
      ids.includes(service.id) ? ids.filter((id) => id !== service.id) : [...ids, service.id]
    )

    setSelectedTime('')
    setSelectedDate('')
    setWeekOffset(0)
  }

  const totalServicos = selectedServices.reduce(
    (total, service) => total + Number(service.price),
    0
  )

  const duracaoSlots = calcularDuracaoSlots(selectedServices)

  const podeAgendar =
    selectedBarber !== null &&
    selectedServices.length > 0 &&
    selectedDate !== '' &&
    selectedTime !== '' &&
    !loadingTimes &&
    !bookingSuccess

  const agora = Date.now()

  const agendamentosAtivos = myBookings
    .filter((appointment) => {
      const itens = appointment.items || []
      const possuiServicoAtivo = itens.some((item) => item.active)

      const dataAgendamento = new Date(
        appointment.starts_at
      ).getTime()

      return (
        appointment.status !== 'cancelled' &&
        possuiServicoAtivo &&
        dataAgendamento > agora
      )
    })
    .sort((a, b) => {
      return (
        new Date(a.starts_at).getTime() -
        new Date(b.starts_at).getTime()
      )
    })

  const agendamentosCancelados = myBookings
    .filter((appointment) => {
      return appointment.status === 'cancelled'
    })
    .sort((a, b) => {
      return (
        new Date(b.starts_at).getTime() -
        new Date(a.starts_at).getTime()
      )
    })

  const agendamentosVisiveis = [
    ...agendamentosAtivos.slice(0, 1),
    ...agendamentosCancelados.slice(0, 1)
  ]

  useEffect(() => {
    let requisicaoAtual = 0
    async function atualizarCatalogoPublico() {
      const requisicao = ++requisicaoAtual
      const [barbeiros, servicos] = await Promise.all([
        supabase.from('barbers').select('id, name, photo_url').eq('active', true),
        supabase.from('services').select('id, name, price, slot_units, icon, description').eq('active', true)
      ])
      if (requisicao !== requisicaoAtual) return

      if (barbeiros.error) {
        console.error('Erro ao buscar barbeiros:', barbeiros.error.message)
      } else {
        const ativos = barbeiros.data || []
        setBarbers(ativos)
        setSelectedBarberId((id) => ativos.some((barbeiro) => barbeiro.id === id) ? id : '')
      }

      if (servicos.error) {
        console.error('Erro ao buscar serviços:', servicos.error.message)
      } else {
        const ativos = servicos.data || []
        setServices(ativos)
        setSelectedServiceIds((ids) => ids.filter((id) => ativos.some((service) => service.id === id)))
      }
    }

    atualizarCatalogoPublico()
    window.addEventListener('focus', atualizarCatalogoPublico)
    return () => {
      requisicaoAtual++
      window.removeEventListener('focus', atualizarCatalogoPublico)
    }
  }, [])

  useEffect(() => {
    let ativo = true

    async function buscarHorariosDisponiveis() {
      if (!selectedDate || !activeBarberId || selectedServiceCount === 0) {
        setAvailableTimes([])
        setLoadingTimes(false)
        return
      }

      setLoadingTimes(true)
      setSelectedTime('')

      const { data, error } = await supabase.rpc(
        'consultar_disponibilidade',
        {
          p_barber_id: activeBarberId,
          p_data: selectedDate,
          p_duracao_slots: duracaoSlots
        }
      )

      if (!ativo) return

      if (error) {
        console.error('Erro ao consultar horários:', error.message)
        setAvailableTimes([])
      } else {
        const horariosLivres = data
          .filter((item) => item.disponivel)
          .map((item) => String(item.horario).slice(0, 5))

        setAvailableTimes(horariosLivres)
      }

      setLoadingTimes(false)
    }

    buscarHorariosDisponiveis()

    return () => {
      ativo = false
    }
  }, [
    selectedDate,
    activeBarberId,
    selectedServiceCount,
    duracaoSlots,
    availabilityRefresh
  ])

  async function confirmarAgendamento() {
    if (!podeAgendar || bookingSubmitting) return

    limparMensagensAgendamento()
    setBookingSubmitting(true)

    try {
      const { data, error } = await supabase.rpc(
        'criar_agendamento',
        {
          p_barber_id: selectedBarber.id,
          p_data: selectedDate,
          p_horario: selectedTime,
          p_service_ids: selectedServices.map((service) => service.id)
        }
      )

      if (error) {
        console.error('Erro ao criar agendamento:', error)
        setBookingError(
          error.message || 'Não foi possível realizar seu agendamento.'
        )
        return
      }

      setBookingId(data)

      setBookingDetails({
        barber: selectedBarber.name,
        services: selectedServices.map((item) => item.name).join(', '),
        date: selectedDate,
        time: selectedTime,
        total: totalServicos
      })

      setBookingSuccess('Seu agendamento foi realizado com sucesso!')
      convidarInstalacao()

      await carregarAgendamentos()
      setAvailabilityRefresh((valor) => valor + 1)
    } catch (error) {
      console.error('Erro inesperado no agendamento:', error)
      setBookingError('Ocorreu um erro inesperado. Tente novamente.')
    } finally {
      setBookingSubmitting(false)
    }
  }

  if (authLoading) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <BrandLogo className="auth-brand" />

          <p>Carregando sua área...</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <BrandLogo className="auth-brand" />

          <p className="auth-eyebrow">SEJA BEM-VINDO</p>

          <h1>Seu próximo corte começa aqui.</h1>

          <p className="auth-description">
            Informe seus dados para acessar sua área de agendamentos.
          </p>

          <form onSubmit={entrarComoCliente}>
            <label htmlFor="customer-name">Seu nome</label>

            <input
              id="customer-name"
              type="text"
              placeholder="Digite seu nome"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              autoComplete="name"
              required
            />

            <label htmlFor="customer-phone">
              Telefone / WhatsApp
            </label>

            <input
              id="customer-phone"
              type="tel"
              placeholder="(84) 99999-9999"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              autoComplete="tel"
              required
            />

            <p className="phone-notice">
              <span>💬</span>
              Este número será utilizado para enviar as confirmações
              dos seus agendamentos pelo WhatsApp. Confira se está correto!
            </p>

            {authError && (
              <p className="auth-error">
                {authError}
              </p>
            )}

            <button type="submit" disabled={authSubmitting}>
              {authSubmitting ? 'AGUARDE...' : 'ENTRAR E AGENDAR'}
            </button>
          </form>

          <small>MR.SALOUM — BARBEARIA</small>
        </div>
      </main>
    )
  }

  return (
    <main className="public-site">
      <header className="navbar">
        <a className="brand" href="#inicio">
          <BrandLogo className="brand-logo" />
        </a>

        <nav>
          <a href="#inicio">Início</a>
          <a href="#barbeiros">Barbeiros</a>
          <a href="#servicos">Serviços</a>

          <a
            href="#meus-agendamentos"
            onClick={(e) => {
              e.preventDefault()
              alternarMeusAgendamentos()
            }}
          >
            Meus horários
          </a>
        </nav>

        <div className="navbar-actions">
          {podeConvidarInstalacao && (
            <button type="button" className="profile-button" onClick={convidarInstalacao}>
              Instalar aplicativo
            </button>
          )}
          <button
            type="button"
            className="bookings-nav-button"
            onClick={alternarMeusAgendamentos}
          >
            Meus horários
          </button>

          <button
            type="button"
            className="profile-button"
            onClick={() => {
              setBookingsOpen(false)
              setProfileOpen(!profileOpen)
              setProfileError('')
              setProfileSuccess('')
            }}
          >
            Meu cadastro
          </button>

        </div>
      </header>

      {/* Convite de instalação: opcional e não intrusivo. */}
      {installOpen && podeConvidarInstalacao && (
        <div role="presentation" onClick={() => setInstallOpen(false)} style={{position:'fixed',inset:0,zIndex:20000,background:'rgba(0,0,0,.78)',display:'flex',alignItems:'center',justifyContent:'center',padding:18}}>
          <section role="dialog" aria-modal="true" aria-labelledby="pwa-title" onClick={(e) => e.stopPropagation()} style={{position:'relative',width:'100%',maxWidth:410,background:'#191817',border:'1px solid #6b5638',borderRadius:18,padding:26,color:'#f5f1e9',boxShadow:'0 20px 80px #000a'}}>
            <button type="button" aria-label="Fechar convite" onClick={() => setInstallOpen(false)} style={{position:'absolute',right:14,top:12,background:'transparent',border:0,color:'#eee',fontSize:27,cursor:'pointer'}}>×</button>
            <BrandLogo className="install-brand-logo" decorative />
            <h2 id="pwa-title" style={{margin:'0 0 10px',fontSize:23}}>Mr.Saloum no seu celular</h2>
            <p style={{lineHeight:1.6,color:'#d5d0c8'}}>Instale gratuitamente para agendar seu próximo corte com apenas um toque. Você também pode continuar usando o site normalmente.</p>
            {installPrompt ? (
              <button type="button" onClick={instalarAplicativo} style={{width:'100%',padding:14,border:0,borderRadius:10,background:'#c5a46d',color:'#151515',fontWeight:800,cursor:'pointer'}}>Instalar aplicativo</button>
            ) : (
              <p style={{fontSize:14,lineHeight:1.6,color:'#e8d1a9'}}>
                {iosDevice
                  ? 'No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.'
                  : 'No Chrome, abra o menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”, quando disponível.'}
              </p>
            )}
            <button type="button" onClick={() => setInstallOpen(false)} style={{display:'block',margin:'14px auto 0',background:'transparent',border:0,color:'#d1cbc2',cursor:'pointer'}}>Agora não</button>
          </section>
        </div>
      )}

      {/* MODAL MEU CADASTRO */}
      {profileOpen && (
        <section
          className="profile-section modal-overlay"
          onClick={() => setProfileOpen(false)}
        >
          <div
            className="profile-card modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-heading">
              <div>
                <span className="eyebrow">SUA CONTA</span>
                <h2>Meu <span>cadastro</span></h2>
                <p>Atualize suas informações de contato.</p>
              </div>

              <button
                type="button"
                className="profile-close"
                onClick={() => setProfileOpen(false)}
                aria-label="Fechar cadastro"
              >
                ×
              </button>
            </div>

            <form onSubmit={salvarDadosCliente}>
              <label htmlFor="profile-name">Nome completo</label>

              <input
                id="profile-name"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Digite seu nome"
                autoComplete="name"
                required
              />

              <label htmlFor="profile-phone">
                Telefone / WhatsApp
              </label>

              <input
                id="profile-phone"
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="(84) 99999-9999"
                autoComplete="tel"
                required
              />

              <div className="profile-phone-notice">
                <strong>💬 Atenção ao número informado</strong>
                <p>
                  Este será seu principal meio de comunicação com a
                  Mr.Saloum. Mantenha-o sempre atualizado.
                </p>
              </div>

              {profileError && (
                <p className="auth-error">
                  {profileError}
                </p>
              )}

              {profileSuccess && (
                <p className="profile-success">
                  {profileSuccess}
                </p>
              )}

              <button
                type="submit"
                className="profile-save"
                disabled={profileSaving}
              >
                {profileSaving ? 'SALVANDO...' : 'SALVAR ALTERAÇÕES'}
              </button>
            </form>
          </div>
        </section>
      )}

      {/* MODAL MEUS AGENDAMENTOS */}
      {bookingsOpen && (
        <section
          className="my-bookings-section modal-overlay"
          id="meus-agendamentos"
          onClick={() => setBookingsOpen(false)}
        >
          <div
            className="modal-panel bookings-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-heading">
              <div>
                <span className="eyebrow">SUA AGENDA</span>
                <h2>Meus <span>agendamentos</span></h2>
                <p>Consulte seus horários e gerencie seus serviços.</p>
              </div>

              <button
                type="button"
                className="profile-close"
                onClick={() => setBookingsOpen(false)}
                aria-label="Fechar meus agendamentos"
              >
                ×
              </button>
            </div>

            {bookingsLoading ? (
              <p className="bookings-feedback">
                Carregando seus agendamentos...
              </p>
            ) : bookingsError ? (
              <p className="bookings-error">
                {bookingsError}
              </p>
            ) : agendamentosVisiveis.length === 0 ? (
              <div className="empty-bookings">
                <span>✂</span>
                <h3>Você ainda não possui agendamentos.</h3>
                <p>Escolha seu barbeiro e reserve seu próximo horário.</p>

                <a
                  href="#barbeiros"
                  className="bookings-link"
                  onClick={() => setBookingsOpen(false)}
                >
                  AGENDAR AGORA
                </a>
              </div>
            ) : (
              <div className="my-bookings-list">
                {agendamentosVisiveis.map((appointment) => {
                  const itens = appointment.items || []
                  const ativos = itens.filter((item) => item.active)
                  const cancelados = itens.filter((item) => !item.active)
                  const cancelado = appointment.status === 'cancelled'

                  const podeCancelarTudo =
                    !cancelado &&
                    new Date(appointment.starts_at).getTime() > Date.now()

                  const agendamentoAntigo = itens.some(
                    (item) => item.starts_at === null
                  )

                  return (
                    <article
                      className={`my-booking-card ${
                        cancelado ? 'booking-cancelled' : ''
                      }`}
                      key={appointment.id}
                    >
                      <div className="my-booking-header">
                        <div>
                          <span className="booking-card-label">
                            BARBEIRO
                          </span>

                          <h3>
                            {appointment.barber_name || 'Barbeiro'}
                          </h3>
                        </div>

                        <span
                          className={`booking-status ${
                            cancelado ? 'status-cancelled' : 'status-confirmed'
                          }`}
                        >
                          {cancelado ? 'Cancelado' : 'Confirmado'}
                        </span>
                      </div>

                      <div className="my-booking-date">
                        <span>📅</span>
                        {formatarDataHora(appointment.starts_at)}
                      </div>

                      <div className="my-booking-services">
                        <h4>Serviços</h4>

                        {ativos.map((item) => (
                          <div
                            className="my-booking-item"
                            key={item.id}
                          >
                            <div className="booking-item-info">
                              <strong>{item.service_name}</strong>

                              <span>
                                {item.starts_at
                                  ? `${formatarHorario(item.starts_at)} – ${formatarHorario(item.ends_at)}`
                                  : 'Horário não individualizado'}
                              </span>

                              <span>
                                R$ {formatarValor(item.price)}
                              </span>
                            </div>

                            {appointment.status === 'confirmed' &&
                              item.starts_at &&
                              new Date(item.starts_at).getTime() > Date.now() && (
                                <button
                                  type="button"
                                  className="cancel-item-button"
                                  onClick={() => cancelarServico(item)}
                                  disabled={cancelLoading !== ''}
                                >
                                  {cancelLoading === item.id
                                    ? 'Cancelando...'
                                    : 'Cancelar serviço'}
                                </button>
                              )}
                          </div>
                        ))}

                        {cancelados.length > 0 && (
                          <details className="cancelled-services">
                            <summary>
                              <span>
                                Ver horários cancelados ({cancelados.length})
                              </span>

                              <span className="cancelled-arrow">⌄</span>
                            </summary>

                            <div className="cancelled-services-list">
                              {cancelados.map((item) => (
                                <div
                                  className="my-booking-item item-cancelled"
                                  key={item.id}
                                >
                                  <div className="booking-item-info">
                                    <strong>{item.service_name}</strong>

                                    <span>
                                      {item.starts_at
                                        ? `${formatarHorario(item.starts_at)} – ${formatarHorario(item.ends_at)}`
                                        : 'Horário não individualizado'}
                                    </span>

                                    <span>
                                      R$ {formatarValor(item.price)}
                                    </span>

                                    <small className="item-cancelled-label">
                                      Serviço cancelado
                                    </small>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>

                      <div className="my-booking-total">
                        <span>
                          {cancelado
                            ? 'Serviços ativos'
                            : 'Total dos serviços ativos'}
                        </span>

                        <strong>
                          R$ {formatarValor(totalItensRegistrados(ativos))}
                        </strong>
                      </div>

                      {agendamentoAntigo && !cancelado && (
                        <p className="legacy-booking-notice">
                          Este é um agendamento anterior à atualização do sistema.
                          Para ele, está disponível apenas o cancelamento completo.
                        </p>
                      )}

                      {podeCancelarTudo && (
                        <button
                          type="button"
                          className="cancel-all-button"
                          onClick={() => cancelarAgendamento(appointment)}
                          disabled={cancelLoading !== ''}
                        >
                          {cancelLoading === appointment.id
                            ? 'Cancelando agendamento...'
                            : 'Cancelar agendamento inteiro'}
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>
            )}

            {bookingsMessage && (
              <p className="bookings-success">
                {bookingsMessage}
              </p>
            )}

            {bookingsError && (
              <p className="bookings-error">
                {bookingsError}
              </p>
            )}

            <button
              type="button"
              className="refresh-bookings-button"
              onClick={carregarAgendamentos}
              disabled={bookingsLoading}
            >
              {bookingsLoading
                ? 'ATUALIZANDO...'
                : 'ATUALIZAR AGENDAMENTOS'}
            </button>
          </div>
        </section>
      )}

      {/* APRESENTAÇÃO COMPACTA */}
      <section className="hero hero-compact" id="inicio">
        <div className="hero-content">
          <span className="eyebrow">MR.SALOUM <i /> BARBEARIA</span>
          <h1>Seu próximo corte começa <span>aqui.</span></h1>
          <p>Escolha seu profissional, selecione os serviços e reserve seu horário.</p>
        </div>
        <div className="hero-side-note">
          <BrandLogo className="hero-side-mark" decorative />
          <span>AGENDE ONLINE<br /><strong>SEM COMPLICAÇÃO</strong></span>
        </div>
      </section>

      {/* ÁREA PRINCIPAL DE AGENDAMENTO */}
      <div className="booking-workspace">
        <div className="booking-options">
      {/* BARBEIROS */}
      <section className="barbers section" id="barbeiros">
        <div className="section-heading">
          <span className="eyebrow">NOSSA EQUIPE</span>

          <h2>
            Escolha seu <span>barbeiro</span>
          </h2>

          <p>
            Profissionais prontos para cuidar do seu estilo.
          </p>
        </div>

        <div className="barber-grid">
          {barbers.map((barber) => (
            <button
              type="button"
              className={`barber-card ${
                selectedBarber?.id === barber.id ? 'selected' : ''
              }`}
              key={barber.id}
              onClick={() => {
                limparMensagensAgendamento()
                if (selectedBarber?.id !== barber.id) {
                  setSelectedServiceIds([])
                  setSelectedDate('')
                  setWeekOffset(0)
                }
                setSelectedBarberId(barber.id)
                setSelectedTime('')

                document.getElementById('servicos')?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start'
                })
              }}
            >
              <div className="barber-avatar">
                {barber.photo_url ? (
                  <img
                    src={barber.photo_url}
                    alt={`Foto de ${barber.name}`}
                  />
                ) : (
                  <span>{barber.name.charAt(0).toUpperCase()}</span>
                )}
              </div>

              <h3>{barber.name}</h3>
            </button>
          ))}
        </div>
      </section>

      {/* SERVIÇOS */}
      <section className="services section" id="servicos" aria-disabled={!selectedBarber} style={!selectedBarber ? {opacity:0.55} : undefined}>
        <div className="section-heading">
          <span className="eyebrow">NOSSO MENU</span>

          <h2>
            Serviços e <span>valores</span>
          </h2>

          <p>
            {selectedBarber ? 'Qualidade e cuidado em cada atendimento.' : 'Primeiro escolha um barbeiro para liberar os serviços.'}
          </p>
        </div>

        <div className="service-grid">
          {services.map((service) => (
            <article
              className={`service-card ${
                selectedServices.some(
                  (item) => item.id === service.id
                )
                  ? 'selected'
                  : ''
              }`}
              key={service.id}
              onClick={() => selecionarServico(service)}
              role="button"
              tabIndex={selectedBarber ? 0 : -1}
              aria-disabled={!selectedBarber}
              onKeyDown={(e) => { if (selectedBarber && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selecionarServico(service) } }}
              style={!selectedBarber ? {cursor:'not-allowed',pointerEvents:'none'} : undefined}
            >
              <div className="service-icon">
                {service.icon}
              </div>

              <div>
                <h3>{service.name}</h3>
                <p>{service.description}</p>
              </div>

              <strong>
                R$ {formatarValor(service.price)}
              </strong>
            </article>
          ))}
        </div>

        <div className="booking-summary">
          <span className="booking-summary-label">VALOR</span>

          <strong className="booking-summary-value">
            R$ {formatarValor(totalServicos)}
          </strong>
        </div>
      </section>
        </div>

      {/* DATA E HORÁRIO */}
      <section className="booking" id="agendar" aria-disabled={!selectedBarber || selectedServices.length === 0} style={!selectedBarber || selectedServices.length === 0 ? {opacity:0.55} : undefined}>
        <div className="booking-panel-heading">
          <span className="eyebrow">ÚLTIMA ETAPA</span>
          <h2>Data e <span>horário</span></h2>
          <p>{!selectedBarber ? 'Escolha primeiro seu barbeiro.' : selectedServices.length === 0 ? 'Escolha pelo menos um serviço para liberar as datas.' : 'Veja os horários disponíveis para seu atendimento.'}</p>
        </div>
        <div className="booking-date">
          <div className="week-navigation">
            <button
              type="button"
              onClick={() => {
                setWeekOffset((atual) => Math.max(0, atual - 1))
              }}
              disabled={weekOffset === 0 || !selectedBarber || selectedServices.length === 0}
            >
              ←
            </button>

            <strong>
              {inicioSemana.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long'
              })}
              {' a '}
              {diasDisponiveis[5].toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long'
              })}
            </strong>

            <button
              type="button"
              onClick={() => {
                setWeekOffset((atual) => Math.min(1, atual + 1))
              }}
              disabled={weekOffset === 1 || !selectedBarber || selectedServices.length === 0}
            >
              →
            </button>
          </div>

          <div className="week-days">
            {diasDisponiveis.map((data) => {
              const dataFormatada = formatarDataLocal(data)
              const diaPassado = data < hoje
              const diaForaDoLimite = data > dataMaxima

              return (
                <button
                  key={dataFormatada}
                  type="button"
                  className={`${
                    selectedDate === dataFormatada ? 'selected' : ''
                  } ${
                    diaPassado || diaForaDoLimite ? 'disabled' : ''
                  }`}
                  disabled={diaPassado || diaForaDoLimite || !selectedBarber || selectedServices.length === 0}
                  onClick={() => {
                    limparMensagensAgendamento()
                    setSelectedDate(dataFormatada)
                    setSelectedTime('')
                  }}
                >
                  <span>
                    {data.toLocaleDateString('pt-BR', {
                      weekday: 'short'
                    }).replace('.', '')}
                  </span>

                  <strong>{data.getDate()}</strong>
                </button>
              )
            })}
          </div>

          {selectedDate && (
            <div className="available-times">
              <h3>Escolha o horário</h3>

              {!selectedBarber ? (
                <p>Selecione um barbeiro para consultar os horários.</p>
              ) : loadingTimes ? (
                <p>Buscando horários disponíveis...</p>
              ) : horariosExibidos.length > 0 ? (
                <div className="time-grid">
                  {horariosExibidos.map((horario) => (
                    <button
                      key={horario}
                      type="button"
                      className={
                        selectedTime === horario ? 'selected' : ''
                      }
                      onClick={() => {
                        limparMensagensAgendamento()
                        setSelectedTime(horario)
                      }}
                    >
                      {horario}
                    </button>
                  ))}
                </div>
              ) : (
                <p>Não há horários disponíveis para esta data.</p>
              )}
            </div>
          )}
        </div>

        {bookingError && (
          <div className="auth-error" role="alert">
            {bookingError}
          </div>
        )}

        {bookingSuccess && (
          <div className="profile-success" role="status">
            <strong>{bookingSuccess}</strong>

            {bookingDetails && (
              <p>
                Barbeiro: {bookingDetails.barber}<br />
                Serviços: {bookingDetails.services}<br />
                Data: {bookingDetails.date}<br />
                Horário: {bookingDetails.time}<br />
                Total: R$ {formatarValor(bookingDetails.total)}
              </p>
            )}

            <small>Agendamento registrado com sucesso.</small>
          </div>
        )}

        <button
          className="primary-button"
          type="button"
          onClick={confirmarAgendamento}
          disabled={!podeAgendar || bookingSubmitting}
        >
          {bookingSubmitting
            ? 'CONFIRMANDO...'
            : bookingSuccess
              ? 'AGENDAMENTO CONFIRMADO'
              : 'AGENDAR'}

          {!bookingSubmitting && !bookingSuccess && <span> →</span>}
        </button>
      </section>
      </div>

      {/* RODAPÉ */}
      <footer>
        <a className="brand" href="#inicio">
          <BrandLogo className="footer-brand-logo" />
        </a>

        <p>
          © 2026 Mr.Saloum — Todos os direitos reservados.
        </p>
      </footer>
    </main>
  )
}

// ======================================================
// DIRECIONAMENTO ENTRE SITE E PAINEL
// ======================================================

function App() {
  const caminho = window.location.pathname

  if (caminho.startsWith('/admin')) {
    return <Suspense fallback={<div role="status"><BrandLogo className="auth-brand" />Carregando painel?</div>}><AdminPage /></Suspense>
  }

  return <ClienteApp />
}

export default App
