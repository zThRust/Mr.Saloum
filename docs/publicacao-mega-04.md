# Preparação da publicação do Mr.Saloum

## Privacidade das consultas

| Origem | Colunas de `barbers` solicitadas |
| --- | --- |
| Site público, `atualizarCatalogoPublico` | `id, name, photo_url`. A projeção anterior era `*`. Aplica filtro `active = true`. |
| Painel, `carregarDadosAgendamentoRapido` | `id, name, active, photo_url`. A projeção explícita foi mantida. |
| Dispatcher de WhatsApp | `id` ou `name` nas consultas existentes. Sem alterações. |

A consulta pública de serviços também passou a listar explicitamente `id, name, price, slot_units, icon, description`. Não foram encontrados embeds `barbers(*)` no checkout. O frontend só lê o telefone individual por `mr_saloum_listar_perfis_editaveis_v1()`. Nenhuma projeção direta do navegador pede `barbers.whatsapp` ou `barbers.catalog_version`. O frontend está preparado para perder a permissão direta de leitura dessas colunas. Essa conclusão cobre o código cliente. A auditoria de grants, views e definições SQL no banco fica separada. Antes de qualquer mudança de grants, considerar clientes com o bundle público anterior em cache, que ainda usa projeção ampla.

## Contratos e liberação

| RPC instalada segundo o estado de implantação informado | Parâmetros do frontend |
| --- | --- |
| `mr_saloum_pode_gerenciar_catalogo_v1()` | Nenhum. Só o booleano `true` mostra o gerenciamento. |
| `mr_saloum_listar_catalogo_v1()` | Nenhum. |
| `mr_saloum_alterar_catalogo_v1()` | `p_kind text`, `p_action text`, `p_id uuid`, `p_expected_version text`, `p_values jsonb`. |
| `mr_saloum_listar_perfis_editaveis_v1()` | Nenhum. A sessão recebe apenas os perfis autorizados pela RPC. |
| `mr_saloum_atualizar_perfil_barbeiro_v1()` | `p_barber_id uuid`, `p_expected_version text`, `p_photo_url text`, `p_whatsapp text`. |

O catálogo usa a capacidade vinculada ao administrador principal e trata negações do banco mesmo depois de abrir. A edição de perfil usa autorização própria e funciona com o catálogo desativado. O roteiro local simula as cinco RPCs. O responsável informou 206 verificações SQL aprovadas e o catálogo desabilitado pelas Megas SQL 19A e 19B. A publicação do frontend preserva esse estado. Confirmar a publicação automática da branch `main` antes do push. O [roteiro concorrente](homologacao-concorrencia.md) é uma validação adicional em banco descartável.

## Arquivos para o commit

Os arquivos de execução são os dois arquivos existentes do app e os seis módulos de frontend listados abaixo. Os testes reproduzíveis e os documentos de integração também compõem a entrega.

```powershell
git add -- src/App.jsx src/App.css src/BarberProfileEditor.jsx src/CatalogManagement.jsx src/MobileBarberCalendar.jsx src/barberCalendarNavigation.js src/barberProfile.js src/bookingValues.js
git add -- tests/barberCalendarNavigation.test.js tests/barberProfile.test.js tests/bookingValues.test.js tests/browser/agenda.mjs
git add -- docs/auditoria-mega-02.md docs/edicao-perfil-barbeiro.md docs/gerenciamento-catalogo.md docs/publicacao-mega-04.md docs/homologacao-concorrencia.md tests/postgres/concorrencia.mjs
git diff --cached --check
git diff --cached --name-status
git diff --cached --stat
```

Manter fora deste commit `package.json` com a alteração local preexistente, `deno.lock`, `.vscode/`, `.env.local` e outros arquivos de ambiente, `supabase/` local, `whatsapp-dispatcher.zip`, `dist/`, `node_modules/` e quaisquer perfis ou logs de teste temporários. O `package-lock.json` rastreado continua sendo a referência da instalação limpa. Foram validados build, 14 testes Node e Chromium com a versão 2.119.0 de Supabase do lockfile, instalada offline com scripts de dependências desativados. O roteiro de navegador é um teste permanente. A busca local por padrões de chave privada, tokens e credenciais não encontrou ocorrências nos arquivos candidatos, com valores de ambiente excluídos da saída.

Após revisar o índice e receber liberação da publicação, os comandos são:

```powershell
git commit -m "Finaliza agenda, catálogo e contatos do Mr.Saloum"
git push origin main
```

O envio à `main` pode disparar a publicação se o serviço estiver configurado para isso. Confirmar essa configuração antes de enviar.

## Validação após publicação

1. Anotar o commit publicado e a versão anterior que comprovadamente funcionava com os grants atuais. Abrir o site em sessão nova e em uma instalação PWA já existente. Conferir a atualização dos assets, os três barbeiros ativos, fotos, serviços e a consulta de horários. Parar antes da confirmação de reserva.
2. Conferir no painel de administrador a data, a agenda móvel e a grade desktop, o histórico e o financeiro em leitura. Verificar a ausência do gerenciamento de catálogo e, com uma conta de barbeiro autorizada, conferir a própria agenda e se o editor de contato lista somente o próprio perfil. Validar gestos que escrevem e mutações de contato no ambiente isolado.
3. Conferir as projeções das consultas da aba de rede, redigindo cabeçalhos e tokens se houver captura. A leitura direta do catálogo de barbeiros deve funcionar com a permissão de telefone revogada.

## Rollback do frontend

Se houver regressão, voltar ao build ou commit anterior comprovadamente compatível com os grants atuais. Se a publicação seguir a branch `main`, preparar um commit reversor com `git revert <commit-da-entrega>`, revisar o diff e publicar pela trilha normal. Antes de usar esse revert, confirmar que o código recuperado tem leitura explícita de `barbers`. Se voltaria a `select('*')`, preparar a reversão mantendo a projeção explícita e testar com os grants atuais. Repetir as verificações do site, do painel e da atualização da PWA. O rollback é do frontend e preserva a privacidade e o estado do catálogo no Supabase.
