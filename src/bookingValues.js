export const SERVICE_SOBRANCELHA_ID = '534e28f8-0c11-47a1-952f-a78aa6735e27'

export function calcularDuracaoSlots(servicos) {
  const principais = servicos.filter(({ id }) => id !== SERVICE_SOBRANCELHA_ID)
  const servicosQueContam = principais.length > 0 ? principais : servicos
  return Math.max(1, servicosQueContam.reduce(
    (total, servico) => total + Number(servico.slot_units || 0), 0
  ))
}

export function totalItensRegistrados(itens) {
  return itens.reduce((total, item) => total + Number(item.price), 0)
}
