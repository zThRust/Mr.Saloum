# Auditoria de escritas e histórico

## Escritas nas seis tabelas

O checkout do Mr.Saloum não contém as definições SQL das RPCs ou dos gatilhos operacionais. A tabela distingue os campos enviados e os efeitos esperados das colunas que ainda precisam ser confirmadas no SQL. As MEGAS SQL 02 a 06 constam como aplicadas no contexto de implantação fornecido para esta tarefa.

Não foi encontrado INSERT, UPDATE, DELETE ou UPSERT direto de `barbers`, `services`, `profiles`, `appointments`, `appointment_items` ou `barber_time_blocks`. As chamadas diretas do código para essas tabelas são leituras.

| Arquivo, linha e função | Operação e finalidade | Campos enviados ou efeito observável | Escopo de usuário |
| --- | --- | --- | --- |
| [App.jsx](../src/App.jsx#L541) · `salvarAgendamentoRapido` | `admin_criar_agendamento_manual`, criação de `appointments` e `appointment_items` | `p_customer_name`, `p_customer_whatsapp`, `p_barber_id`, `p_data`, `p_horario`, `p_service_ids`. Colunas, defaults e valores históricos dependem do corpo SQL. | Administrador ou barbeiro na própria agenda na interface. Confirmar grants e escopo efetivo no SQL. |
| [App.jsx](../src/App.jsx#L2960) · `confirmarAgendamento` | `criar_agendamento`, criação de `appointments` e `appointment_items` | `p_barber_id`, `p_data`, `p_horario`, `p_service_ids`. Colunas e vinculação efetiva dependem do SQL. | Cliente com sessão, normalmente anônima autenticada. |
| [App.jsx](../src/App.jsx#L585) · `AdminPage.cancelarAgendamento` | `admin_cancelar_agendamento`, cancelamento de reserva | `p_appointment_id`. A interface espera status cancelado. Atualização de itens, timestamps e demais efeitos dependem do SQL. | Painel autenticado. Conferir o escopo exato nas correções informadas. |
| [App.jsx](../src/App.jsx#L2594) · `ClienteApp.cancelarAgendamento` | `cancelar_agendamento`, cancelamento de reserva | `p_appointment_id`. A interface espera reserva cancelada. Efeitos em `appointments` e `appointment_items` a confirmar no SQL. | Cliente proprietário, conforme finalidade e correções informadas. |
| [App.jsx](../src/App.jsx#L2561) · `cancelarServico` | `cancelar_servico_agendamento`, cancelamento parcial | `p_appointment_item_id`. Conferir colunas do item e eventual atualização da reserva pai. | Cliente proprietário da reserva do item, conforme finalidade e correções informadas. |
| [App.jsx](../src/App.jsx#L616) · `marcarAtendimento` | `admin_marcar_atendimento`, marca ou desfaz realização | `p_appointment_id`, `p_realizado`. A leitura de `completed_at` e `completed_by` vem de `painel_atendimentos`. Tabela gravada e efeitos em `appointments` dependem do SQL. | Painel autenticado. Conferir escopo efetivo no SQL. |
| [App.jsx](../src/App.jsx#L1070) · `alterarBloqueio` | `admin_alternar_bloqueio`, cria ou libera bloqueio de `barber_time_blocks` | `p_barber_id`, `p_data`, `p_horario`, `p_bloquear`. Confirmar colunas e se a liberação faz DELETE ou UPDATE. | Administrador ou barbeiro no próprio ID na interface. Conferir o mesmo limite no SQL. |
| [CatalogManagement.jsx](../src/CatalogManagement.jsx#L115) · `mutate` | `mr_saloum_alterar_catalogo_v1`, contrato pendente para INSERT, UPDATE e DELETE de catálogo e vínculo de perfil | Tipo, ação, ID, versão e valores. Barbeiro envia `name`, `photo_url` e, na criação, `profile_id`. Serviço envia `name`, `price`, `slot_units`, `icon` e `description`. Transições pedem mudança de `active`. Cadastro de barbeiro prevê vínculo e role em `profiles`. | Administrador principal por `public.is_master_admin()` dentro da RPC; interface depende da RPC de capacidade. |

A função WhatsApp lê `barbers` e `appointments` por SELECT. Suas RPCs de fila são `whatsapp_finish_notification`, `whatsapp_claim_notifications_spaced`, `whatsapp_claim_matheus_test` e `whatsapp_claim_controlled_test`. Sem o SQL, eventuais efeitos indiretos dessas funções ou dos gatilhos de fila nas seis tabelas ficam por verificar. [Dispatcher](../supabase/functions/whatsapp-dispatcher/index.ts#L64)

O cliente público usa Auth para gravar `full_name` e `phone` nos metadados da própria conta durante autenticação anônima e edição. O componente `AuthGate`, sem uso no fluxo executado, enviaria `name` e `whatsapp` no cadastro Auth. Eventual escrita indireta em `profiles` por gatilho requer revisão do esquema. [Edição do cliente](../src/App.jsx#L2714) · [Cadastro AuthGate](../src/AuthGate.jsx#L72)

## Foto e telefone de Isaac e João

O painel lê `profiles.name`, `role` e `barber_id`. As fotos vêm de `barbers.photo_url`. O checkout não mostra formulário de autoedição para barbeiros, upload, escrita direta ou RPC própria. O catálogo prevê edição administrativa de foto e seu payload não inclui telefone. A edição de telefone encontrada pertence ao cliente e usa metadados Auth. O canal real usado por Isaac e João permanece por identificar.

Primeiro confirmar o canal atual, o destino do telefone (contato público, WhatsApp, metadado ou identidade de login), o armazenamento da foto e eventuais gatilhos. Um contrato de autoedição no painel deve identificar o ator pela sessão e resolver internamente o alvo por `auth.uid()` → `profiles.barber_id`. Deve aceitar exclusivamente foto e telefone de contato conforme os campos comprovados, validar os formatos, limitar a escrita ao próprio vínculo e impedir alterações de role, vínculo, catálogo alheio e identidade de login. Para upload, revisar também Storage e permissões do objeto. A auditoria não pressupõe um nome de RPC nem altera o fluxo.

## Ativos e histórico

- O agendamento rápido consulta apenas [barbeiros e serviços ativos](../src/App.jsx#L225). O público aplica o mesmo filtro para [barbeiros](../src/App.jsx#L2867) e [serviços](../src/App.jsx#L2884). Segundo a implantação informada, a disponibilidade rejeita inativos e as duas RPCs de agendamento usam `lock_active_booking_resources(uuid, uuid[])`.
- A agenda de administrador também usa os IDs e nomes históricos devolvidos pela RPC. Um barbeiro fora do catálogo ativo entra na visão geral quando tem reserva confirmada no dia selecionado e pode ser filtrado pelo histórico. A seção histórica mostra as reservas sem buscar disponibilidade ou oferecer horários. Registros sem ID continuam acessíveis na lista geral.
- O [financeiro](../src/App.jsx#L2264) renderiza os totais de `painel_financeiro` por ID. “Todas as agendas” não filtra por estado ativo. A RPC ainda precisa ser revisada para demonstrar que devolve os inativos elegíveis e usa os valores dos itens registrados.
- O [histórico do cliente](../src/App.jsx#L3290) exibe `item.service_name` e `item.price` de `meus_agendamentos` e soma esses itens. `item.active` representa o estado do item na reserva. Confirmar no SQL que nomes e preços devolvidos vêm de registros históricos.
- A [regra de duração](../src/App.jsx#L8) preserva o UUID da sobrancelha `534e28f8-0c11-47a1-952f-a78aa6735e27` e o fallback histórico por nome.

## Navegador local

O [roteiro automatizado](../tests/browser/agenda.mjs) usa dados sintéticos. No PowerShell, iniciar o Vite com as variáveis temporárias `VITE_SUPABASE_URL=http://127.0.0.1:59887` e `VITE_SUPABASE_PUBLISHABLE_KEY` com valor fictício, usando `npm.cmd run dev -- --host 127.0.0.1 --port 5179 --strictPort`. Abrir uma instância Chromium de teste com perfil temporário e `--remote-debugging-port=9436` e executar `node tests/browser/agenda.mjs`. O roteiro intercepta as chamadas do Supabase e só admite a origem fictícia.
