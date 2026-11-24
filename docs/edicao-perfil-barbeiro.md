# Edição de contato do barbeiro

As duas RPCs abaixo estão instaladas segundo o estado informado para as MEGAS SQL 07 a 14. A interface só exibe o editor depois de receber uma lista autorizada e válida. Uma lista vazia, resposta incompatível ou falha mantém a edição indisponível. A gestão de catálogo mantém sua capacidade própria e continua desabilitada em produção.

| RPC | Assinatura | Retorno |
| --- | --- | --- |
| Listar | `mr_saloum_listar_perfis_editaveis_v1()` | Array JSONB com `id` (UUID em texto), `name`, `photo_url`, `whatsapp`, `active` e `version` (texto opaco, não vazio). Campos de contato podem ser nulos. |
| Atualizar | `mr_saloum_atualizar_perfil_barbeiro_v1(p_barber_id uuid, p_expected_version text, p_photo_url text, p_whatsapp text)` | `void`. |

O banco deve autorizar as duas RPCs pela sessão autenticada. O barbeiro comum só pode acessar o registro vinculado a `auth.uid()` por `profiles.barber_id`. O administrador principal identificado por `public.is_master_admin()` pode acessar qualquer barbeiro, inclusive inativo. Um administrador sem designação principal, cliente ou sessão anônima não recebe registros editáveis. Revalidar a autorização na mutação, inclusive quando chamada diretamente.

Somente `photo_url` e o telefone de contato `whatsapp` são graváveis. Confirmar a coluna de contato no esquema antes de implementar o SQL. O telefone não é o remetente nem o grupo das notificações. O frontend envia URL HTTPS sem credenciais e telefone brasileiro com DDD como dígitos, mantendo o prefixo 55 quando informado. Campo vazio chega como `null` e representa remoção do valor. O SQL deve validar esses dados, restringir colunas, comparar a versão sob bloqueio e atualizar a versão a cada mudança. Validar a concorrência com edições do catálogo que possam alterar a mesma foto.

Tratar `42501` para acesso negado, `MS004` para conflito de versão ou registro removido e `22023` para dados inválidos. Após revogação, conflito ou falha de resultado incerto o formulário é invalidado. A pessoa precisa recarregar e conferir os valores antes de submeter novamente. A mutação é feita por POST, sem repetição automática. O frontend não usa UPDATE direto nem oferece upload.
