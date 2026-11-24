# Separação do DONO e do cadastro operacional de Matheus

`is_master_admin()` já identifica a conta principal pelo UUID de Auth e pelo papel `admin`. O vínculo operacional não é necessário para agenda geral, financeiro, catálogo ou fotos. Agenda e financeiro selecionam todas as agendas pelo papel administrativo, incluindo o histórico de barbeiros inativos. `can_delete_barber` e o gatilho continuam protegendo o cadastro operacional de Matheus contra exclusão definitiva. Os dois pontos que impediam a desativação eram o gatilho `guard_barber_lifecycle` e a RPC `mr_saloum_alterar_catalogo_v1`.

O SQL preserva o UUID da conta, papel, dados de Auth, UUID e nome do cadastro operacional, referências, histórico e registros financeiros. O perfil passa a se chamar DONO e fica sem `barber_id`. O cadastro de Matheus fica inativo até reativação explícita. Isaac e João conservam os vínculos e permissões. O catálogo ganha `can_deactivate` como campo adicional da listagem. O frontend aceita também a listagem antiga, mantém `can_delete` e diferencia desativação protegida, agendamentos impeditivos e exclusão definitiva.

## Execução

1. Rode [SQL 00 de prévia](sql/SQL_FINAL_07_00_PREVIA.sql) pelo SQL Editor do projeto autorizado. Confira o perfil principal, os nomes da vitrine e o total de reservas impeditivas. Use o SQL 00 novamente após a migração para conferir a vitrine. A situação de produção precisa ser determinada por essa consulta.
2. Se a prévia estiver correta, execute [SQL 01 de migração](sql/SQL_FINAL_07_01_SEPARAR_DONO.sql) inteiro. Se houver reserva confirmada futura ou em andamento, a transação falha com `MS001` e informa a quantidade. Resolva os agendamentos pelo fluxo existente antes de repetir. Se a versão das funções divergir da restaurada, o SQL também aborta integralmente.
3. Confira com o DONO o acesso a agenda, financeiro, equipe, serviços e configurações. A vitrine deve listar Isaac e João. Com as contas individuais, confira acesso somente ao próprio painel. O catálogo mantém a flag anterior. Se estiver desabilitado, as ações de equipe só aparecem quando a flag for habilitada separadamente pelo procedimento já adotado pelo projeto.
4. Para reverter, execute [SQL 02 de rollback](sql/SQL_FINAL_07_02_ROLLBACK.sql). Ele restaura as três definições anteriores, o nome, o vínculo e o estado operacional anteriores. O script aborta se detectar alterações posteriores incompatíveis. A trilha de auditoria permanece e registra a reativação do rollback quando aplicável.
5. O [SQL 03 de testes](sql/SQL_FINAL_07_03_TESTES.sql) é exclusivo do clone isolado. Cria dados fictícios dentro de transação e executa rollback ao final.

Para executar cada arquivo no Docker local, use PowerShell e substitua o nome do arquivo pela etapa desejada:

```powershell
$OutputEncoding = [Text.UTF8Encoding]::new($false)
Get-Content -Raw -Encoding utf8 docs/sql/SQL_FINAL_07_00_PREVIA.sql |
  docker --context desktop-linux exec -i supabase_db_mr-saloum-homologacao psql -X -U postgres -v ON_ERROR_STOP=1
```

No clone, prepare dois barbeiros fictícios ativos chamados Isaac e João, mantenha o cadastro operacional de teste de Matheus e o UUID administrativo restaurado, e deixe os gatilhos de WhatsApp desabilitados. Após a prévia, execute SQL 01 → SQL 03 → SQL 02. Para testar a barreira inicial, crie uma reserva fictícia confirmada e futura para Matheus no clone, execute SQL 01 e confira `MS001` e a permanência da reserva. Retire a fixture local antes de testar a migração bem-sucedida.
