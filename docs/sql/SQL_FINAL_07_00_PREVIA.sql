-- Consulta prévia somente leitura. Nenhum dado de clientes é exibido.
BEGIN READ ONLY;
SELECT p.role, p.barber_id IS NULL AS sem_vinculo,
  p.barber_id = '1ce68aac-44da-41bc-b9e5-d62cc0406a7c'::uuid AS vinculado_a_matheus
FROM public.profiles p WHERE p.id = 'd1a3b46e-50d3-4347-bde8-ef1e5e84da54';
SELECT b.name, b.active FROM public.barbers b
WHERE b.active OR b.id = '1ce68aac-44da-41bc-b9e5-d62cc0406a7c' ORDER BY b.name;
SELECT count(*) AS reservas_impeditivas, min(a.starts_at) AS proxima_reserva
FROM public.appointments a WHERE a.barber_id = '1ce68aac-44da-41bc-b9e5-d62cc0406a7c'
  AND a.status = 'confirmed' AND a.ends_at > clock_timestamp();
SELECT enabled AS catalogo_habilitado FROM mr_saloum_private.catalog_config WHERE singleton;
COMMIT;
