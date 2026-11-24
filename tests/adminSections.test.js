import test from 'node:test'
import assert from 'node:assert/strict'
import { adminSections } from '../src/adminSections.js'

const ids = (role, catalog, editableProfiles = []) =>
  adminSections({ role, catalog, editableProfiles }).map(({ id }) => id)

test('Agenda inicia o painel e o administrador principal tem as cinco seções com catálogo habilitado', () => {
  assert.deepEqual(ids('admin', true), ['agenda', 'equipe', 'servicos', 'financeiro', 'configuracoes'])
})

test('contatos autorizados mantêm Equipe disponível com catálogo desabilitado', () => {
  assert.deepEqual(ids('admin', false, [{ id: 'own' }]), ['agenda', 'equipe', 'financeiro', 'configuracoes'])
  assert.deepEqual(ids('admin', false), ['agenda', 'financeiro', 'configuracoes'])
})

test('barbeiros não veem Equipe ou Serviços mesmo com capacidade inesperada', () => {
  assert.deepEqual(ids('barber', true, [{ id: 'own' }]), ['agenda', 'financeiro', 'configuracoes'])
})
