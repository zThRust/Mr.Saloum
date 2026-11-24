# Entrega do Mr.Saloum

## Homologação local

- Supabase restaurado no container `supabase_db_mr-saloum-homologacao`, com Auth, PostgREST, Storage e Supabase Edge Runtime reais. Os três gatilhos de WhatsApp estavam desabilitados. A homologação usou contas e imagens fictícias.
- SQL 01 instalado e SQL 02 aprovado no clone. A validação de Storage aceita o índice único tradicional e o índice parcial da versão atual. Atestado e associação excluem versões arquivadas e marcadores de remoção.
- O Edge recebeu WebP válido, publicou o arquivo processado e devolveu a URL. O Storage serviu o objeto. Arquivo inválido retornou 422 e cliente autenticado recebeu 403. O Storage rejeitou envio direto por um barbeiro. A RPC de perfil associou e substituiu a foto, rejeitou uma referência inválida preservando a foto anterior e aceitou remoção.
- Para testar associação em loopback, a cópia local da RPC de perfil recebeu uma exceção temporária apenas para a origem e caminho locais do bucket. Em produção a RPC e o SQL 03 exigem HTTPS. O Edge foi executado em container local dedicado, com o Supabase restaurado como backend.
- O administrador principal passou no teste de cadastro vinculado, atualização de nome, foto e telefone, desativação e reativação de barbeiro. O barbeiro vinculado apresentou exclusão indisponível. Um serviço descartável passou por cadastro, alteração de nome, preço e duração, desativação, reativação e exclusão. Um cliente autenticado teve capacidade de catálogo negada.
- `node --test` aprovou 27 testes. `npm.cmd run lint` e `npm.cmd run build` passaram com avisos. `deno check --node-modules-dir=none --no-lock supabase/functions/barber-photo-upload/index.ts` passou. Os dois testes Deno do codec também passaram. O Chromium exercitou painel, agenda, financeiro, catálogo, contato e privacidade com mocks em 360, 390, 412, 768, 1280 e 1920 px.
- A instalação limpa com o manifesto e o lockfile rastreados, os três builds e a transição de PWA legado → B → C passaram. O Chromium verificou espera durante operação, sessão, preservação de cache de outra aplicação e recarga única.
- Os 21 casos extensivos de concorrência e o backup geral foram adiados conforme solicitado.

## Preparação da publicação

1. Confirme o projeto no Supabase, a configuração do bucket público `barber-photos` com limite de 307200 bytes e MIME `image/webp`, e a revisão atual do frontend no Render para rollback.
2. Execute `SQL_FINAL_PHOTOS_01_INSTALL.sql` seguido de `SQL_FINAL_PHOTOS_02_TESTS.sql`. O SQL 01 bloqueia envios diretos ao bucket e deixa a capacidade de fotos e a limpeza automática desabilitadas. Os SQLs antigos `SQL_PENDING_FINAL_PHOTOS.sql` e `SQL_FINAL_PRIVACIDADE_BARBERS.sql` ficam fora desta sequência.
3. Publique somente a função de fotos com `npx.cmd supabase functions deploy barber-photo-upload --project-ref <REF_DO_MR_SALOUM>`. A função usa `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` no runtime do Supabase. Confira o `OPTIONS` do domínio publicado e a resposta para sessão ausente através do gateway antes de abrir a capacidade. Para domínios adicionais, configure `MR_SALOUM_PHOTO_ORIGINS` com as origens HTTPS explícitas, separadas por vírgulas. O domínio atual já é aceito por padrão.
4. Para o frontend, mantenha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. `VITE_SITE_URL` é opcional e tem como padrão o domínio atual no Render. Aponte o host de publicação ao `dist` gerado a partir do manifesto e lockfile rastreados. Confirme `/admin/`, `/sitemap.xml`, `/robots.txt` e `/mr-saloum-share.jpg` no host.
5. Após publicação do frontend e smoke do gateway, preencha o origin HTTPS da API Supabase e confirme a homologação no SQL 03. Mantenha `allow_loopback_for_clone = false`. O catálogo usa a flag existente e requer decisão separada para ativação exclusiva do administrador principal. A edição do perfil continua com autorização independente.
6. Valide página pública, acesso ao painel, isolamento de perfis, leitura privada do telefone, carregamento das agendas/financeiro, PWA e referências de foto. Para verificar escrita remotamente, use somente uma conta autorizada com procedimento previamente combinado. Em caso de regressão nas fotos, execute SQL 04 e volte o frontend para o deploy anterior no Render se necessário. O SQL 04 preserva referências e arquivos existentes. Restaure separadamente a flag de catálogo se ela tiver sido alterada.

### Caminhos candidatos ao commit

```powershell
git add -- index.html admin/index.html vite.config.js src/App.jsx src/AdminApp.jsx src/barberPhotoStorage.js scripts/seo.mjs public/favicon-48.png public/mr-saloum-share.jpg
git add -- tests/seo.test.js tests/browser/agenda.mjs tests/browser/build-pwa-fixtures.ps1 tests/edge/webp.check.ts
git add -- supabase/functions/barber-photo-upload/index.ts supabase/functions/barber-photo-upload/codec.ts supabase/functions/barber-photo-upload/codec-data.ts supabase/functions/barber-photo-upload/CODEC-LICENSE.txt
git add -- docs/sql/SQL_FINAL_PHOTOS_01_INSTALL.sql docs/sql/SQL_FINAL_PHOTOS_02_TESTS.sql docs/sql/SQL_FINAL_PHOTOS_03_ENABLE.sql docs/sql/SQL_FINAL_PHOTOS_04_ROLLBACK.sql docs/entrega-definitiva-mr-saloum.md
git diff --cached --check
git diff --cached --name-status
git commit -m "Finaliza painel, SEO e upload validado de fotos"
git push origin HEAD
```

Deixe fora a alteração local de `package.json`, `deno.lock`, arquivos de ambiente, configurações locais do Supabase e do editor, ZIPs, exportações, fixtures, artefatos de build, mudanças de concorrência e arquivos locais do dispatcher WhatsApp. Confirme a branch conectada ao Render antes do push.

## Auditoria da senha PostgreSQL

| Componente | Dependências identificadas |
| --- | --- |
| Frontend | `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` para HTTP |
| Edge de fotos | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e opcional `MR_SALOUM_PHOTO_ORIGINS`, para Auth, RPC e Storage por HTTP |
| Dispatcher WhatsApp | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_API_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY`, `WHATSAPP_DISPATCH_SECRET`, `WHATSAPP_LIVE_ENABLED`, `WHATSAPP_TEST_AUTO_ENABLED`, `WHATSAPP_TEST_APPOINTMENT_ID` e `WHATSAPP_TEST_PHONE`. O dispatcher acessa Supabase e Evolution por HTTP. |
| Ferramentas de banco | Scripts de homologação e exportação usam PostgreSQL diretamente conforme a configuração local. |
| Render | Dependências configuradas no painel, serviços auxiliares e Environment Groups ainda não verificados. |

`DATABASE_URL`, `POSTGRES_URL`, `SUPABASE_DB_URL` e `PGPASSWORD` estavam ausentes do ambiente do processo auditado. O acesso autenticado à CLI confirma o acesso ao plano de gerenciamento. Um dump autenticado sem senha pela CLI v3 pode provisionar um login temporário no banco, portanto requer autorização para essa operação. Se Temporary Access já estiver autorizado para o projeto, pode fornecer acesso com credenciais de curta duração conforme a política do projeto. Nenhuma dessas operações foi executada. O proprietário já confirmou a exportação estrutural e a restauração no clone.
