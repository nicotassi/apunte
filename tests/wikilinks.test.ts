import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backlinks, candidates, cleanTitle, findNote, normTitle, renameLinksInBody, stripWikiLinks, wikiHtml } from '../src/lib/wikilinks.ts';
import type { Note } from '../src/lib/types.ts';

const mk = (id: string, title: string, body = '', extra: Partial<Note> = {}): Note => ({ id, title, body, folderId: null, tags: [], pinned: false, trashed: false, createdAt: 1, updatedAt: 1, ...extra });

test('normTitle ignora acentos, mayúsculas y espacios', () => {
  assert.equal(normTitle('  Reunión   Clave '), 'reunion clave');
  assert.equal(cleanTitle('a [b] | c'), 'a b c');
});

test('findNote encuentra por título sin importar acentos y prefiere la más reciente', () => {
  const notes = [mk('a', 'Reunión', '', { updatedAt: 1 }), mk('b', 'reunion', '', { updatedAt: 5 }), mk('c', 'Otra', '', { trashed: true })];
  assert.equal(findNote('REUNIÓN', notes)?.id, 'b');
  assert.equal(findNote('Otra', notes), undefined); // en la papelera no cuenta
  assert.equal(findNote('No existe', notes), undefined);
});

test('candidates: primero los que empiezan con lo escrito, sin la nota actual', () => {
  const notes = [mk('a', 'Viaje a Lisboa', '', { updatedAt: 1 }), mk('b', 'Lisboa', '', { updatedAt: 2 }), mk('c', 'Compras'), mk('d', 'Mi Lisboa favorita', '', { updatedAt: 3 })];
  assert.deepEqual(candidates('lis', notes).map((n) => n.id), ['b', 'd', 'a']);
  assert.deepEqual(candidates('lis', notes, 'b').map((n) => n.id), ['d', 'a']);
  assert.equal(candidates('', notes).length, 4);
});

test('backlinks: notas que mencionan a otra, también con texto alternativo', () => {
  const lisboa = mk('a', 'Lisboa');
  const notes = [lisboa, mk('b', 'Plan', 'ver [[Lisboa]] y más'), mk('c', 'Otra', 'ver [[lisboa|la ciudad]]'), mk('d', 'Nada', 'sin enlaces'), mk('e', 'Código', '`[[Lisboa]]`', { trashed: true })];
  assert.deepEqual(backlinks(lisboa, notes).map((n) => n.id).sort(), ['b', 'c']);
});

test('renameLinksInBody cambia el título y conserva el texto alternativo', () => {
  assert.equal(renameLinksInBody('a [[Lisboa]] b [[LISBOA|la ciudad]] c [[Oporto]]', 'Lisboa', 'Lisboa 2025'), 'a [[Lisboa 2025]] b [[Lisboa 2025|la ciudad]] c [[Oporto]]');
});

test('texto de tarjetas y HTML del PDF', () => {
  assert.equal(stripWikiLinks('ver [[Lisboa]] y [[Oporto|la otra]]'), 'ver Lisboa y la otra');
  assert.equal(wikiHtml('<p>ver [[Lisboa]] y <code>[[no]]</code> [[A|b]]</p>'), '<p>ver <span class="wikilink">Lisboa</span> y <code>[[no]]</code> <span class="wikilink">b</span></p>');
});
