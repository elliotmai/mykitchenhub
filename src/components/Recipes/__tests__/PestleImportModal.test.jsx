// The Pestle import: pick the export, see what will come in, import it.
// Firestore is the shared mock, so writes are checked at the batch boundary.

import React from 'react';
import { strToU8, zipSync } from 'fflate';

import { renderWithProviders, screen, userEvent, waitFor } from '../../../test-utils';
import * as fs from '../../../test-utils/mocks/firestore';
import PestleImportModal from '../PestleImportModal';
import { BATCH_SIZE } from '../../../hooks/usePestleImport';

const recipeMd = (name, { steps = true } = {}) =>
  `# ${name}\n\n**Servings** 2.0\n\n## Ingredients\n\n* 1 cup rice\n\n## Instructions\n\n${
    steps ? '1. Cook it.' : ''
  }\n`;

const zipFile = (entries, name = 'Export_11-9-2026.zip') => {
  const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
  return new File([zip], name, { type: 'application/zip' });
};

/** A batch double that records every document it is handed. */
const trackBatches = () => {
  const written = [];
  const commits = [];
  fs.writeBatch.mockImplementation(() => {
    const batch = {
      set: jest.fn((_ref, data) => written.push(data)),
      commit: jest.fn(async () => undefined),
    };
    commits.push(batch.commit);
    return batch;
  });
  return { written, commits };
};

const renderModal = (props = {}) => {
  const onHide = jest.fn();
  const view = renderWithProviders(
    <PestleImportModal show onHide={onHide} existingRecipes={[]} {...props} />
  );
  return { ...view, onHide };
};

const pick = async (file) => {
  await userEvent.upload(screen.getByLabelText(/pestle export/i), file);
};

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('previews the export, skips what is already in the library, then imports the rest', async () => {
  const { written } = trackBatches();
  renderModal({ existingRecipes: [{ name: 'Miso Soup' }] });

  await pick(
    zipFile({
      'Miso Soup.md': recipeMd('Miso Soup'),
      'Blini.md': recipeMd('Blini', { steps: false }),
      'Pierogi.md': recipeMd('Pierogi'),
      'broken.md': 'no title',
    })
  );

  expect(await screen.findByText(/2 recipes/)).toBeInTheDocument();
  expect(screen.getByText(/1 recipe already in your library will be skipped/)).toBeInTheDocument();
  expect(screen.getByText(/1 file couldn’t be read/)).toBeInTheDocument();
  expect(screen.getByText(/no steps saved for Blini/)).toBeInTheDocument();
  expect(fs.writeBatch).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: /import 2/i }));

  expect(await screen.findByText(/2 recipes added to your library/)).toBeInTheDocument();
  expect(written.map((d) => d.name)).toEqual(['Blini', 'Pierogi']);
  expect(written[0]).toMatchObject({
    source: 'user-created',
    importedFrom: 'pestle',
    createdBy: expect.any(String),
    createdAt: { __sentinel: 'serverTimestamp' },
  });
});

it('writes large exports in batches', async () => {
  const { written, commits } = trackBatches();
  renderModal();

  const entries = {};
  for (let i = 0; i < BATCH_SIZE + 3; i += 1) entries[`r${i}.md`] = recipeMd(`Recipe ${i}`);
  await pick(zipFile(entries));

  await userEvent.click(await screen.findByRole('button', { name: `Import ${BATCH_SIZE + 3}` }));
  await screen.findByText(new RegExp(`${BATCH_SIZE + 3} recipes added`));

  expect(commits).toHaveLength(2);
  expect(written).toHaveLength(BATCH_SIZE + 3);
});

it('says how far it got when a batch fails', async () => {
  let call = 0;
  fs.writeBatch.mockImplementation(() => ({
    set: jest.fn(),
    commit: jest.fn(async () => {
      call += 1;
      if (call === 2) throw Object.assign(new Error('nope'), { code: 'permission-denied' });
    }),
  }));
  renderModal();

  const entries = {};
  for (let i = 0; i < BATCH_SIZE + 1; i += 1) entries[`r${i}.md`] = recipeMd(`Recipe ${i}`);
  await pick(zipFile(entries));
  await userEvent.click(await screen.findByRole('button', { name: /^import/i }));

  expect(
    await screen.findByText(new RegExp(`${BATCH_SIZE} of ${BATCH_SIZE + 1} recipes were imported`))
  ).toBeInTheDocument();
});

it('explains when the file holds no recipes', async () => {
  renderModal();
  await pick(zipFile({ 'photo.jpg': 'not a recipe', 'readme.txt': 'hello' }));
  expect(await screen.findByText(/no pestle recipes found/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^import/i })).toBeDisabled();
});

it('explains when the zip is corrupt', async () => {
  renderModal();
  await pick(new File(['not a zip'], 'Export.zip', { type: 'application/zip' }));
  expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
});

it('accepts loose markdown files and closes on Done', async () => {
  trackBatches();
  const { onHide } = renderModal();
  await pick(new File([recipeMd('Miso Soup')], 'Miso Soup.md', { type: 'text/markdown' }));
  await userEvent.click(await screen.findByRole('button', { name: /import 1/i }));
  await userEvent.click(await screen.findByRole('button', { name: /done/i }));
  await waitFor(() => expect(onHide).toHaveBeenCalled());
});
