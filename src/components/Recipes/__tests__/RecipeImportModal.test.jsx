// The recipe importer: paste a chat reply, or pick a Pestle export; see what
// will come in; import it.
// Firestore is the shared mock, so writes are checked at the batch boundary.

import React from 'react';
import { strToU8, zipSync } from 'fflate';

import { renderWithProviders, screen, userEvent, waitFor } from '../../../test-utils';
import * as fs from '../../../test-utils/mocks/firestore';
import RecipeImportModal from '../RecipeImportModal';
import { RECIPE_FORMAT_PROMPT } from '../../../utils/recipeImport';
import { BATCH_SIZE } from '../../../hooks/useRecipeImport';

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
    <RecipeImportModal show onHide={onHide} existingRecipes={[]} {...props} />
  );
  return { ...view, onHide };
};

const pick = async (file) => {
  await userEvent.click(screen.getByRole('tab', { name: /pestle export/i }));
  await userEvent.upload(screen.getByLabelText(/pestle export/i, { selector: 'input' }), file);
};

const paste = async (text) => {
  const box = screen.getByLabelText(/recipe text/i, { selector: 'textarea' });
  await userEvent.clear(box);
  // userEvent.type treats { and [ as key descriptors; paste sidesteps that.
  box.focus();
  await userEvent.paste(text);
  await userEvent.click(screen.getByRole('button', { name: /preview/i }));
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
  expect(screen.getByText(/no steps found for Blini/i)).toBeInTheDocument();
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

describe('pasting a recipe', () => {
  const CHAT_REPLY = `Here's a quick one!

# Garlic Butter Noodles

**Servings** 2

## Ingredients
* 8 oz spaghetti
* 3 tbsp butter

## Instructions
1. Boil the pasta.
2. Toss with butter.`;

  it('opens on the paste tab, previews, and imports as a pasted recipe', async () => {
    const { written } = trackBatches();
    const onOpenRecipe = jest.fn();
    const { onHide } = renderModal({ onOpenRecipe });

    expect(screen.getByRole('tab', { name: /paste a recipe/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await paste(CHAT_REPLY);

    expect(await screen.findByText('Garlic Butter Noodles')).toBeInTheDocument();
    expect(screen.getByText(/2 ingredients · 2 steps/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /import 1/i }));

    expect(await screen.findByText(/1 recipe added/)).toBeInTheDocument();
    expect(written[0]).toMatchObject({
      name: 'Garlic Butter Noodles',
      importedFrom: 'pasted',
      servings: 2,
    });
    expect(written[0].tags).not.toContain('pestle');

    await userEvent.click(screen.getByRole('button', { name: /open recipe/i }));
    expect(onHide).toHaveBeenCalled();
    expect(onOpenRecipe).toHaveBeenCalledWith(expect.any(String));
  });

  it('skips a recipe that is already in the library', async () => {
    renderModal({ existingRecipes: [{ name: 'garlic butter noodles' }] });
    await paste(CHAT_REPLY);
    expect(
      await screen.findByText(/already in your library will be skipped \(Garlic Butter Noodles\)/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^import/i })).toBeDisabled();
  });

  it('says what is wrong with text that is not a recipe', async () => {
    renderModal();
    await paste('Sure, what would you like to cook tonight?');
    expect(await screen.findByText(/couldn’t find a recipe/i)).toBeInTheDocument();
  });

  it('prefills text shared from another app', () => {
    renderModal({ initialText: CHAT_REPLY });
    expect(screen.getByLabelText(/recipe text/i, { selector: 'textarea' })).toHaveValue(CHAT_REPLY);
  });

  it('copies the format for the assistant', async () => {
    const user = userEvent.setup();
    const writeText = jest.spyOn(navigator.clipboard, 'writeText');
    renderModal();
    await user.click(screen.getByRole('button', { name: /copy format/i }));
    expect(writeText).toHaveBeenCalledWith(RECIPE_FORMAT_PROMPT);
    expect(await screen.findByRole('button', { name: /format copied/i })).toBeInTheDocument();
  });

  it('falls back when the clipboard API is refused', async () => {
    const user = userEvent.setup();
    jest.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    document.execCommand = jest.fn(() => true);
    renderModal();
    await user.click(screen.getByRole('button', { name: /copy format/i }));
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(await screen.findByRole('button', { name: /format copied/i })).toBeInTheDocument();
    delete document.execCommand;
  });
});
