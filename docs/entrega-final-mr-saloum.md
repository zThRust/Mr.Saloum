# Entrega final do Mr.Saloum

## Diagnóstico da versão antiga

O Render entregava o HTML público com `/registerSW.js`, o bundle `index-DS6s_XY4.js` e o CSS `index-BFlTy_Oj.css`. O `/sw.js` publicado continha Workbox, `createHandlerBoundToURL` e `index.html`. Isso corresponde à configuração anterior no commit `c475c43`, cujo `navigateFallback` servia o HTML pré-armazenado em navegações controladas. Uma janela sem o worker baixava o HTML publicado, enquanto uma sessão antiga podia continuar usando o HTML e os bundles anteriores. O registrador anterior oferecia pouca assistência para ativar o worker que estava esperando.

As respostas públicas para `/`, `/sw.js` e `/manifest.webmanifest` retornaram 200. O cabeçalho observado foi `Cache-Control: public, max-age=0, s-maxage=300`, com `CF-Cache-Status: EXPIRED` na consulta HEAD. O CDN pode atrasar em até cinco minutos a descoberta de um novo arquivo nesse regime. Os GETs de `/admin`, `/admin/` e `/admin/index.html` retornaram 404 no build publicado. O worker anterior ocultava esse problema para sessões sob seu controle. O novo build gera `admin/index.html` como entrada estática. O novo worker tenta essa entrada quando `/admin` ou `/admin/` retorna 404. Na primeira visita sem worker, usar a URL explícita `/admin/index.html`. Um rewrite do Render para a URL curta continua opcional e depende do responsável por produção.

## Atualização e migração da PWA

- Mantidos URL e escopo de registro `/sw.js` e `/`, o manifesto, os ícones e o ponto de instalação existente. O registro usa `updateViaCache: 'none'`. A aplicação consulta atualização na abertura, foco, retorno à aba, volta à rede e a cada cinco minutos enquanto visível, com intervalo mínimo de um minuto.
- As entradas estáticas usam a rede antes do cache da PWA. Há fallback offline restrito a HTML estático válido, sem consultas na URL ou cabeçalho de autorização, e com respeito a `private` e `no-store`. Só bundles e assets do build entram no pré-cache. A aplicação não intercepta respostas do Supabase ou downloads de fotos. Os caches novos têm prefixo próprio. O worker conserva duas gerações anteriores de assets para reduzir falhas de chunks em abas ainda abertas. Os caches antigos do Workbox são preservados durante a transição.
- Uma versão em espera exibe aviso discreto. Formulários abertos, reserva em preparação, mutações, bloqueios e ações de atendimento bloqueiam a recarga. Uma ativação iniciada em outra aba nunca recarrega o documento atual. O clique seguro aplica a atualização uma vez e preserva a sessão.
- Recuperação para uma instalação antiga, em ordem. Salvar ou cancelar a operação aberta. Fechar todas as abas e janelas da PWA dessa origem, inclusive as que ficaram em segundo plano. Reabrir com rede depois de o CDN servir o novo worker. Para o painel, testar `/admin/index.html`. Se a instalação continuar presa, no DevTools da origem usar **Application → Service Workers → Update**, fechar as abas da origem e reabrir. Como último recurso, remover apenas o registro de `/sw.js` da origem pelo DevTools e abrir a URL estática de novo. Não usar **Clear site data**, nem limpar armazenamento de autenticação.

## Fotos e dependências SQL

Os formulários de cadastro, edição administrativa e perfil oferecem arquivo, câmera quando o navegador disponibiliza captura, prévia circular, enquadramento por zoom e posição, cancelamento e remoção. As fotos atuais aparecem mesmo com a capacidade desligada. Editar um telefone preserva a referência legada. O navegador inspeciona a assinatura e as dimensões antes da decodificação, aceita JPEG, PNG e WebP até 10 MiB, limita o lado a 8.192 px e o total a 24 milhões de pixels. A orientação segue o decodificador do navegador. Canvas recorta e reencoda em WebP até 512 px por lado, sem copiar EXIF ou geolocalização. A compressão tenta 150 KiB e recusa o resultado acima de 300 KiB.

O upload usa `barber-photos/<barber_id>/<uuid>.webp` sem upsert. A referência só é gravada depois do upload, pela RPC existente com versão esperada. Uma falha mantém a referência anterior. Um resultado incerto exige recarga e conferência. O navegador não apaga objetos. Uma criação com foto usa o ID e a versão retornados pelo vínculo de perfil. Se a criação tiver sucesso e a foto falhar, o cadastro fica disponível para retomar pela própria linha.

| Contrato | Papel |
| --- | --- |
| `mr_saloum_pode_editar_foto_v1(p_barber_id uuid)` → `boolean` | Capacidade independente para o barbeiro alvo. `null` indica cadastro e exige administrador principal e capacidade de catálogo. Ausência, erro ou resposta diferente de `true` mantém upload e remoção indisponíveis. |
| `mr_saloum_criar_barbeiro_para_foto_v1(p_values jsonb)` → `jsonb {id,version}` | Encapsula a criação v1 e resolve o registro pelo UUID do perfil vinculado na mesma transação. A criação v1 sem foto permanece intacta. |
| Cinco RPCs de catálogo e perfil instaladas | Assinaturas mantidas. O SQL proposto valida novas referências por gatilho em `barbers.photo_url` e conserva URLs legadas inalteradas. |

O arquivo [SQL_PENDING_FINAL_PHOTOS.sql](sql/SQL_PENDING_FINAL_PHOTOS.sql) inclui o bucket dedicado, RLS escopada, validação da pasta, gatilho de referência, matriz positiva e negativa, auditoria e rollback. A leitura do GET público é necessária para exibir fotos. A proposta restringe listagem, sobrescrita e exclusão pelo navegador. O navegador valida os bytes por decodificação. No backend, o limite e o tipo declarado são conferidos pelo Storage e pelos metadados. Não há decodificação de bytes no PostgreSQL.

O job futuro usa teste de referências e carência de sete dias, claim transacional protegido pelo mesmo lock do gatilho, tombstone e exclusão física exclusivamente pela Storage API privilegiada. Deve permanecer desligado até validar o inventário de referências. Política de Storage, guarda de referência e limpeza continuam pendentes de testes integrados no clone. Nenhum SQL foi executado.

## Concorrência e restauração

As 21 rodadas do [roteiro anterior](homologacao-concorrencia.md) não foram executadas. Não foi localizado `psql`, serviço PostgreSQL nos ports locais inspecionados ou engine Docker Desktop acessível. O checkout não contém a cadeia SQL real. Preparar um clone PostgreSQL/Supabase sem tráfego de saída e obter um export **só de esquema** autorizado ou as migrações originais, excluindo dados, fixtures reais, credenciais e segredos. Aplicar as migrações em ordem, criar identidades sintéticas e manter dispatcher, cron, webhooks e filas de entrega sem consumidores.

O pacote deve conter `auth.users`, `auth.uid()`, `auth.jwt()`, papéis, privilégios e as tabelas `profiles`, `barbers`, `services`, `appointments`, `appointment_items` e `barber_time_blocks`. Restaurar as RPCs reais de reserva, catálogo, perfil e bloqueio, `is_master_admin()`, `lock_active_booking_resources`, `trg_guard_barber_lifecycle`, os demais gatilhos chamados por essas operações, constraints, índices, RLS e suas dependências. Usar os catálogos do clone para confirmar as extensões instaladas, incluindo as que sustentam exclusões ou tipos, em vez de presumir nomes ou versões. Para fotos, acrescentar Storage Auth, `storage.buckets`, `storage.objects`, as duas RPCs propostas e os objetos deste patch.

Depois de homologar a cadeia original, testar também substituições simultâneas com a mesma versão, remoção contra substituição, claim contra associação nos dois sentidos e upload próprio contra desativação. Após cada falha, verificar foto persistida, existência do objeto, versão, vínculos e histórico. Confirmar que claims não removem referência vencedora e que uploads órfãos continuam disponíveis para o mecanismo autorizado. Sem a cadeia real, o roteiro não pode ser substituído por RPCs simplificadas.

## Testes e escopo de publicação

Usar `node --test`, `npm.cmd run lint`, `npm.cmd run build` e `git diff --check`. O roteiro [agenda.mjs](../tests/browser/agenda.mjs) cobre 360, 390, 412, 768, 1280 e 1920 px com Supabase simulado. O roteiro [pwa.mjs](../tests/browser/pwa.mjs) compara um build com configuração antiga e dois builds novos em uma mesma origem e perfil de Chromium. [build-pwa-fixtures.ps1](../tests/browser/build-pwa-fixtures.ps1) monta os três em pasta local ignorada, com lockfile rastreado e variáveis fictícias. Com Chrome de teste e CDP local na porta 9436, executar `node tests/browser/pwa.mjs <pasta>/antigo <pasta>/B <pasta>/C`.

- **23 testes Node aprovados**, também na instalação limpa. Lint e build passaram. O lint registrou 15 avisos. O Vite registrou aviso de tamanho do bundle e do uso de uma opção de bundling pelo plugin PWA.
- **Chromium em seis larguras aprovado** com sandbox do navegador ativo. Rodou agenda, financeiro, catálogo, perfil e fluxo simulado de fotos. Cobriu arquivo inválido e grande, recorte e tamanho final, cancelamento, falha, cadastro com foto, substituição e remoção com perda de resposta. O isolamento e os SQLSTATEs exercitados nesse roteiro são simulados.
- **PWA legado → B → C aprovada.** A etapa local reproduziu HTML antigo sob controle do Workbox, worker em espera e migração após fechar a aba. O roteiro disparou a checagem de atualização para controlar o momento da troca. A segunda troca aguardou o encerramento do agendamento manual aberto, preservou a sessão e o cache de outro aplicativo e recarregou uma vez. O teste usou o mesmo perfil Chromium. Câmera física e janela standalone instalada em celular permanecem para validação de publicação.
- **PostgreSQL 0/21 executadas.** Storage, RLS, referências e limpeza em banco real permanecem para homologação no clone. As 206 verificações SQL históricas informadas ficam separadas dos testes desta rodada.

Arquivos autorizados para a publicação do frontend. A proposta de SQL é revisada e distribuída separadamente.

```powershell
git add -- admin/index.html vite.config.js src/main.jsx src/sw.js src/pwaUpdate.js src/PwaUpdateBanner.jsx src/App.jsx src/App.css
git add -- src/BarberPhotoField.jsx src/barberPhoto.js src/barberPhotoStorage.js src/barberProfile.js src/BarberProfileEditor.jsx src/CatalogManagement.jsx
git add -- tests/barberPhoto.test.js tests/pwaUpdate.test.js tests/browser/agenda.mjs tests/browser/pwa.mjs tests/browser/build-pwa-fixtures.ps1
git add -- docs/entrega-final-mr-saloum.md
git diff --cached --check
git diff --cached --name-status
```

`package.json` local, arquivos de ambiente, configurações locais, ZIP, Supabase local, locks não relacionados e artefatos ficam fora. Quando o lançamento for autorizado, usar `git commit -m "Corrige atualização da PWA e prepara fotos dos barbeiros"` e `git push origin main`. O push pode iniciar a publicação automática no Render.

### Ordem de lançamento e rollback

1. Publicar o frontend com capacidade de fotos desligada ou ausente, após aprovar a PWA. Checar matriz de URLs, instalação, sessões antigas e atualização por espera. As cinco RPCs existentes continuam operacionais. Usar o catálogo no estado desabilitado atual.
2. Homologar SQL de fotos e Storage num clone. Conferir MIME, tamanho, autorização, caminho e proteção de objetos de terceiros. Aprovar a instalação de produção separadamente, com a configuração de fotos inicialmente desligada. Habilitar capacidade só depois das verificações integradas. A habilitação do catálogo continua independente e exige autorização própria.
3. Após publicar, conferir os cabeçalhos públicos de HTML, `/sw.js` e manifesto, o status da entrada administrativa estática e a navegação do público até a disponibilidade. Verificar painel, catálogo desabilitado, privacidade e uma atualização na PWA instalada sem registrar reservas ou enviar notificações. Ajustes de headers ou rewrites do Render exigem ação de produção separada.
4. Para rollback de frontend, voltar a um build compatível com as permissões atuais. Manter um worker de recuperação que obtenha HTML da rede, para evitar reintroduzir o problema de cache. Se o rollback também desativar fotos, desligar a capacidade e o job, preservar bucket, arquivos e referências. Não restaurar grants amplos, mexer em autenticação nem apagar dados do navegador.
