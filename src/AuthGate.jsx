
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './AuthGate.css'

function AuthGate({ children }) {
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(true)
  const [mode, setMode] = useState('login')

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecking(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setChecking(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')

    if (password.length < 8) {
      setMessage('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    if (mode === 'register') {
      const cleanPhone = phone.replace(/\D/g, '')

      if (!name.trim()) {
        setMessage('Informe seu nome completo.')
        return
      }

      if (cleanPhone.length < 10 || cleanPhone.length > 11) {
        setMessage('Informe um WhatsApp válido com DDD.')
        return
      }

      if (!email.trim()) {
        setMessage('Informe seu e-mail.')
        return
      }

      if (password !== confirmPassword) {
        setMessage('As senhas não são iguais.')
        return
      }
    }

    setLoading(true)

    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: {
              name: name.trim(),
              whatsapp: phone.trim(),
            },
          },
        })

        if (error) throw error

        if (!data.session) {
          setMessage(
            'Cadastro criado! Verifique seu e-mail para confirmar a conta.'
          )
          return
        }

        setMessage('Conta criada com sucesso!')
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })

        if (error) throw error
      }
    } catch (error) {
      setMessage(
        error.message || 'Não foi possível concluir o acesso.'
      )
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      setMessage(error.message)
      return
    }

    setPassword('')
    setConfirmPassword('')
    setMessage('')
    setMode('login')
  }

  if (checking) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
        <p>Carregando...</p>
      </div>
    )
  }

  if (session) {
    const customerName =
      session.user.user_metadata?.name ||
      session.user.email ||
      'Cliente'

    return (
      <>
        <div className="auth-user-bar">
          <span>
            Olá, <strong>{customerName}</strong>
          </span>

          <button onClick={logout}>
            Sair da conta
          </button>
        </div>

        {children}
      </>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">MR.SALOUM</div>
        <p className="auth-subtitle">BARBEARIA</p>

        <h1>
          {mode === 'register'
            ? 'Crie sua conta'
            : 'Acesse sua conta'}
        </h1>

        <p className="auth-description">
          {mode === 'register'
            ? 'Cadastre-se para agendar seus horários.'
            : 'Entre para acessar seus agendamentos.'}
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login')
              setMessage('')
            }}
          >
            Entrar
          </button>

          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register')
              setMessage('')
            }}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <label>Nome completo</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                autoComplete="name"
                required
              />

              <label>WhatsApp com DDD</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(84) 99999-9999"
                autoComplete="tel"
                inputMode="tel"
                required
              />
            </>
          )}

          <label>E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seuemail@email.com"
            autoComplete="email"
            required
          />

          <label>Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo de 8 caracteres"
            autoComplete={
              mode === 'register'
                ? 'new-password'
                : 'current-password'
            }
            minLength={8}
            required
          />

          {mode === 'register' && (
            <>
              <label>Confirmar senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Digite a senha novamente"
                autoComplete="new-password"
                required
              />
            </>
          )}

          {message && (
            <p className="auth-message">{message}</p>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={loading}
          >
            {loading
              ? 'Aguarde...'
              : mode === 'register'
                ? 'Criar minha conta'
                : 'Entrar'}
          </button>
        </form>

        <p className="auth-privacy">
          Seu acesso ficará salvo neste dispositivo.
          Você poderá sair da conta quando quiser.
        </p>
      </div>
    </div>
  )
}

export default AuthGate
