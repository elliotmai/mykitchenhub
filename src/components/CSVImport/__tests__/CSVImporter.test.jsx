// The importer's job is to tell someone what a file will do to their kitchen
// before it does it. These tests drive it the way a person does: pick a file,
// read the preview, decide.

import React from 'react';
import { renderWithProviders, screen, waitFor, within, act } from '../../../test-utils';

import CSVImporter from '../CSVImporter';
import { makeLocation, makeImportRecord } from '../../../test-utils/factories';

const LOCATIONS = [
  makeLocation({ id: 'loc-fridge', label: 'Main Fridge', type: 'fridge' }),
  makeLocation({ id: 'loc-pantry', label: 'Pantry', type: 'pantry' }),
];

const GOOD_CSV = [
  'name,quantity,unit,location',
  'Whole Milk,1,gal,Main Fridge',
  'Basmati Rice,5,lbs,Pantry',
].join('\n');

const MIXED_CSV = [
  'name,quantity,unit,location',
  'Whole Milk,1,gal,Main Fridge',
  ',2,lbs,Pantry',
  'Mystery Jar,1,ea,Wine Cellar',
].join('\n');

const csvFile = (text, name = 'kitchen.csv') => new File([text], name, { type: 'text/csv' });

const setup = (props = {}) => {
  const onImport =
    props.onImport ?? jest.fn(async () => ({ success: true, imported: 2, skipped: 0 }));
  const onHide = props.onHide ?? jest.fn();

  const view = renderWithProviders(
    <CSVImporter show onHide={onHide} locations={LOCATIONS} {...props} onImport={onImport} />
  );

  return { ...view, onImport, onHide };
};

/** Choose a file and wait for the preview (or the file-level complaint). */
const chooseFile = async (user, text, name) => {
  await user.upload(screen.getByLabelText(/choose a csv file/i), csvFile(text, name));
};

describe('CSVImporter', () => {
  it('explains the format before a file is chosen', () => {
    setup();

    expect(screen.getByLabelText(/choose a csv file/i)).toBeInTheDocument();
    expect(screen.getByText(/what should the file look like/i)).toBeInTheDocument();
    // The user's own location labels, so they know what to type in the column.
    expect(screen.getByText(/Main Fridge, Pantry/)).toBeInTheDocument();
  });

  it('previews the rows it can import', async () => {
    const { user } = setup();

    await chooseFile(user, GOOD_CSV);

    expect(await screen.findByText('2 ready to import')).toBeInTheDocument();
    expect(screen.getByText('Whole Milk')).toBeInTheDocument();
    expect(screen.getByText('Basmati Rice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 2 items' })).toBeEnabled();
  });

  it('names the file and row count it is working from', async () => {
    const { user } = setup();

    await chooseFile(user, GOOD_CSV, 'january.csv');

    expect(await screen.findByText(/january\.csv — 2 rows/)).toBeInTheDocument();
  });

  it('lists every bad row with its line number and what is wrong', async () => {
    const { user } = setup();

    await chooseFile(user, MIXED_CSV);

    expect(await screen.findByText('1 ready to import')).toBeInTheDocument();
    expect(screen.getByText('2 need fixing')).toBeInTheDocument();

    // Second table on the preview: the rows we had to skip.
    const skipped = screen.getAllByRole('table')[1];
    expect(within(skipped).getByText('Missing item name.')).toBeInTheDocument();
    expect(
      within(skipped).getByText('No storage location called "Wine Cellar".')
    ).toBeInTheDocument();
    // Line 3 is the blank-name row; line 1 is the header.
    expect(within(skipped).getByText('3')).toBeInTheDocument();
  });

  it('refuses a file whose columns it cannot use', async () => {
    const { user } = setup();

    await chooseFile(user, 'fruit,howmany\napples,3');

    expect(await screen.findByText(/needs a name, quantity, location column/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
  });

  it('offers no import when every row is broken', async () => {
    const { user } = setup();

    await chooseFile(user, 'name,quantity,location\n,0,Nowhere');

    expect(await screen.findByText(/None of these rows can be imported yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 0 items' })).toBeDisabled();
  });

  it('hands the validated rows to the importer, with the skipped ones counted', async () => {
    const onImport = jest.fn(async () => ({ success: true, imported: 1, skipped: 2 }));
    const { user } = setup({ onImport });

    await chooseFile(user, MIXED_CSV, 'january.csv');
    await user.click(await screen.findByRole('button', { name: 'Import 1 item' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const [rows, meta] = onImport.mock.calls[0];

    expect(rows).toHaveLength(1);
    expect(rows[0].data).toMatchObject({ name: 'Whole Milk', locationId: 'loc-fridge' });
    expect(meta).toMatchObject({ fileName: 'january.csv', skipped: 2 });
    expect(meta.errors).toHaveLength(2);
  });

  it('confirms what landed in the kitchen', async () => {
    const onImport = jest.fn(async () => ({ success: true, imported: 2, skipped: 1 }));
    const { user } = setup({ onImport });

    await chooseFile(user, GOOD_CSV);
    await user.click(await screen.findByRole('button', { name: 'Import 2 items' }));

    expect(await screen.findByText('2 items added to your kitchen.')).toBeInTheDocument();
    expect(screen.getByText(/1 row skipped/)).toBeInTheDocument();
  });

  it('says what went wrong when the import fails', async () => {
    const onImport = jest.fn(async () => ({ success: false, error: 'permission denied' }));
    const { user } = setup({ onImport });

    await chooseFile(user, GOOD_CSV);
    await user.click(await screen.findByRole('button', { name: 'Import 2 items' }));

    expect(await screen.findByText('The import did not finish.')).toBeInTheDocument();
    expect(screen.getByText('permission denied')).toBeInTheDocument();
  });

  it('shows progress while a large file is saving', async () => {
    const { user } = setup({ importing: true, progress: { processed: 500, total: 1200 } });

    await chooseFile(user, GOOD_CSV);

    expect(await screen.findByText('500/1200')).toBeInTheDocument();
    expect(screen.getByText(/saved 500 at a time/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /importing/i })).toBeDisabled();
  });

  it('lets the user back out and choose a different file', async () => {
    const { user } = setup();

    await chooseFile(user, GOOD_CSV);
    await user.click(await screen.findByRole('button', { name: /choose a different file/i }));

    expect(screen.getByLabelText(/choose a csv file/i)).toBeInTheDocument();
    expect(screen.queryByText('2 ready to import')).not.toBeInTheDocument();
  });

  it('offers another import once one has finished', async () => {
    const { user, onHide } = setup();

    await chooseFile(user, GOOD_CSV);
    await user.click(await screen.findByRole('button', { name: 'Import 2 items' }));
    await user.click(await screen.findByRole('button', { name: /import another file/i }));

    expect(screen.getByLabelText(/choose a csv file/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onHide).toHaveBeenCalled();
  });

  it('closes on Done', async () => {
    const { user, onHide } = setup();

    await chooseFile(user, GOOD_CSV);
    await user.click(await screen.findByRole('button', { name: 'Import 2 items' }));
    await user.click(await screen.findByRole('button', { name: /done/i }));

    expect(onHide).toHaveBeenCalled();
  });

  it('lists recent imports so a repeat import is obvious', () => {
    setup({
      history: [
        makeImportRecord({ id: 'i1', fileName: 'january.csv', itemsImported: 42, itemsSkipped: 3 }),
      ],
    });

    expect(screen.getByText(/january\.csv: 42 added, 3 skipped/)).toBeInTheDocument();
  });

  it('asks for a storage location before accepting a file', async () => {
    const { user } = setup({ locations: [] });

    await chooseFile(user, GOOD_CSV);

    expect(await screen.findByText(/Add a storage location in Settings/)).toBeInTheDocument();
  });

  it('forgets a rejected file so the same one can be chosen again', async () => {
    // The whole-file error leaves the picker on screen and tells someone to go
    // fix their spreadsheet. A file input fires no change event when the same
    // file is chosen twice running, so the input has to let go of the choice —
    // otherwise coming back with the fixed file does nothing at all.
    const { user } = setup();
    const input = screen.getByLabelText(/choose a csv file/i);

    await chooseFile(user, 'fruit,howmany\napples,3', 'january.csv');
    expect(await screen.findByText(/needs a name, quantity, location column/i)).toBeInTheDocument();
    expect(input).toHaveValue('');

    await user.upload(input, csvFile(GOOD_CSV, 'january.csv'));

    expect(await screen.findByText('2 ready to import')).toBeInTheDocument();
  });

  it('shows an error rather than hanging when the import throws', async () => {
    const onImport = jest.fn(async () => {
      throw new Error('network is offline');
    });
    const { user } = setup({ onImport });

    await chooseFile(user, GOOD_CSV);
    await user.click(await screen.findByRole('button', { name: 'Import 2 items' }));

    expect(await screen.findByText('The import did not finish.')).toBeInTheDocument();
    expect(screen.getByText('network is offline')).toBeInTheDocument();
  });

  it('treats an importer that answers with nothing as a failure', async () => {
    const onImport = jest.fn(async () => undefined);
    const { user } = setup({ onImport });

    await chooseFile(user, GOOD_CSV);
    await user.click(await screen.findByRole('button', { name: 'Import 2 items' }));

    expect(await screen.findByText('Import did not complete.')).toBeInTheDocument();
  });

  it('summarises a long list of problems instead of printing all of them', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => `Bad ${i},,ea,Nowhere`);
    const { user } = setup();

    await chooseFile(user, ['name,quantity,unit,location', ...rows].join('\n'));

    expect(await screen.findByText('60 need fixing')).toBeInTheDocument();
    expect(screen.getByText('…and 35 more.')).toBeInTheDocument();
    // 25 shown + the header row.
    expect(within(screen.getAllByRole('table')[0]).getAllByRole('row')).toHaveLength(26);
  });

  it('reaches the file input and both preview tables from the keyboard', async () => {
    const { user } = setup();

    // First stop is the modal's close button, second is the file input.
    await user.tab();
    await user.tab();
    expect(screen.getByLabelText(/choose a csv file/i)).toHaveFocus();

    await chooseFile(user, MIXED_CSV);
    await screen.findByText('1 ready to import');

    // Each table is named by the heading above it, and its columns are headers.
    const [ready, skipped] = screen.getAllByRole('table');
    expect(ready).toHaveAccessibleName('Ready to import');
    expect(skipped).toHaveAccessibleName('Rows we had to skip');
    expect(within(ready).getAllByRole('columnheader')).toHaveLength(3);
    expect(within(skipped).getAllByRole('columnheader')).toHaveLength(2);
    // The counts are a live region, so they are read out after a file is picked.
    expect(screen.getByRole('status')).toHaveTextContent('1 ready to import');
  });

  it('describes import progress for a screen reader', async () => {
    const { user } = setup({ importing: true, progress: { processed: 500, total: 1200 } });

    await chooseFile(user, GOOD_CSV);

    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAccessibleName('Import progress');
    expect(bar).toHaveAttribute('aria-valuetext', '500 of 1200 items saved');
  });

  it('reports a file it could not read at all', async () => {
    const { user } = setup();
    const broken = csvFile(GOOD_CSV);
    // Simulate a browser that cannot read the file off disk.
    jest.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function () {
      this.onerror(new Error('unreadable'));
    });

    await act(async () => {
      await user.upload(screen.getByLabelText(/choose a csv file/i), broken);
    });

    expect(await screen.findByText(/could not read that file/i)).toBeInTheDocument();
    jest.restoreAllMocks();
  });
});
