# Painel administrativo do Mr.Saloum

A Agenda abre após o login. A navegação troca o conteúdo sem recarregar a página e preserva data, modo e barbeiro selecionado na agenda móvel. O menu apresenta as seções autorizadas para a sessão.

| Seção | Administrador | Barbeiro |
| --- | --- | --- |
| Agenda | Agenda geral, calendário ou lista, filtros, histórico, agendamento manual, bloqueios e ações de atendimento existentes. | Agenda individual e ações dentro do escopo atual do banco. |
| Equipe | Cadastro e alterações de catálogo quando a capacidade retorna `true`. A edição de foto e contato depende da listagem independente de perfis editáveis e funciona com o catálogo desabilitado. | Seção oculta. A edição do próprio contato fica em Configurações. |
| Serviços | Seção disponível com capacidade de catálogo igual a `true`. Criação, alteração, ativação e desativação e exclusão quando o banco permite. | Seção oculta. |
| Financeiro | Totais retornados pelo Supabase por barbeiro, com seletor de data independente da Agenda. | Apenas os valores do próprio vínculo já permitidos pelo Supabase. |
| Configurações | Identidade e acesso em leitura, acesso à Agenda e aos contatos autorizados da Equipe. | Identidade e acesso em leitura, agenda e edição do próprio contato quando autorizado. |

O fechamento semanal continua disponível nas datas previstas pela regra existente. A divisão do faturamento continua em 50% para cada parte. Quando há atendimentos marcados como realizados na agenda carregada, o painel indica essa contagem separadamente dos totais do banco.

## Dependências para futuras configurações

- Edição dos dados institucionais da barbearia precisa de um contrato para leitura e escrita desses dados com autorização.
- Horários padrão de funcionamento precisam de um contrato próprio. O painel atual encaminha para os bloqueios pontuais da Agenda.
- Preferências de notificações precisariam de uma interface pública de configuração com campos autorizados. A configuração interna do WhatsApp segue no fluxo existente.
- Gestão de permissões e segurança precisaria de contratos específicos. O painel mostra o papel e mantém o fluxo de autenticação e saída existente.

As cinco RPCs de catálogo e contato mantêm seus contratos. Nenhuma configuração estrutural ou permissão foi adicionada no Supabase.
