import React from 'react';
import { act, fireEvent, renderWithProviders, screen, waitFor } from '../../test-utils';
import * as backend from '../../backend/timers';
import * as ringer from '../ringer';
import { TimersProvider, useTimers, insideHive } from '../TimersProvider';
import StepTimer from '../StepTimer';

jest.mock('../ringer', () => ({
  unlockAudio: jest.fn(() => true),
  askToNotify: jest.fn(async () => 'granted'),
  notifyDone: jest.fn(),
  startRinging: jest.fn(() => jest.fn()),
  audioReady: jest.fn(() => false),
}));

const NOW = Date.parse('2026-11-25T18:00:00Z');
const row = (id, secondsFromNow, extra = {}) => ({
  id,
  key: null,
  label: id,
  duration_s: 600,
  ends_at: new Date(NOW + secondsFromNow * 1000).toISOString(),
  ...extra,
});

const Probe = () => {
  const { timers, start, stop } = useTimers();
  return (
    <div>
      <span data-testid="count">{timers.length}</span>
      <button onClick={() => start({ label: 'Eggs', minutes: 7 })}>start eggs</button>
      <button onClick={() => start({ minutes: 0 })}>start nothing</button>
      {timers.map((t) => (
        <button key={t.id} onClick={() => stop(t.id)}>
          stop {t.label}
        </button>
      ))}
    </div>
  );
};

const renderAt = (now, ui = <Probe />) =>
  renderWithProviders(<TimersProvider now={now}>{ui}</TimersProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  backend.listTimers.mockResolvedValue([]);
  backend.watchTimers.mockImplementation(() => () => {});
  ringer.startRinging.mockImplementation(() => jest.fn());
});

it('loads the household timers and listens for changes', async () => {
  backend.listTimers.mockResolvedValue([row('Rice', 300)]);
  renderAt(NOW);
  expect(await screen.findByText(/5:00/)).toBeInTheDocument();
  expect(backend.watchTimers).toHaveBeenCalled();
});

it('starts a timer from its end time and unlocks the sound on that tap', async () => {
  renderAt(NOW);
  await waitFor(() => expect(backend.listTimers).toHaveBeenCalled());
  fireEvent.click(screen.getByText('start eggs'));
  await waitFor(() => expect(backend.addTimer).toHaveBeenCalled());
  const inserted = backend.addTimer.mock.calls[0][0];
  expect(inserted).toMatchObject({ label: 'Eggs', duration_s: 420 });
  expect(Date.parse(inserted.ends_at)).toBeGreaterThan(Date.now() + 419000);
  expect(ringer.unlockAudio).toHaveBeenCalled();
  expect(ringer.askToNotify).toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
});

it('takes a timer back off when it could not be saved', async () => {
  backend.addTimer.mockRejectedValueOnce(new Error('offline'));
  renderAt(NOW);
  fireEvent.click(screen.getByText('start eggs'));
  await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
  fireEvent.click(screen.getByText('start nothing'));
  expect(backend.addTimer).toHaveBeenCalledTimes(1);
});

it('rings for a finished timer until it is stopped, everywhere', async () => {
  const stopSound = jest.fn();
  ringer.startRinging.mockImplementation(() => stopSound);
  backend.listTimers.mockResolvedValue([row('Pasta', -2)]);
  renderAt(NOW);

  expect(await screen.findByRole('alertdialog')).toHaveTextContent('Pasta is done');
  expect(ringer.startRinging).toHaveBeenCalledTimes(1);
  expect(ringer.notifyDone).toHaveBeenCalledWith(expect.objectContaining({ label: 'Pasta' }));
  expect(screen.getByText(/Tap anywhere/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(backend.removeTimer).toHaveBeenCalledWith('Pasta'));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(stopSound).toHaveBeenCalled();
});

it('rings for several at once and stops them all', async () => {
  backend.listTimers.mockResolvedValue([row('Pasta', -2), row('Sauce', -1), row('Bread', 60)]);
  renderAt(NOW);
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('2 timers are done');
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  await waitFor(() => expect(backend.removeTimer).toHaveBeenCalledTimes(2));
});

it('puts a timer back when stopping it failed', async () => {
  backend.listTimers.mockResolvedValue([row('Rice', 300)]);
  backend.removeTimer.mockRejectedValueOnce(new Error('offline'));
  renderAt(NOW);
  fireEvent.click(await screen.findByText('stop Rice'));
  await waitFor(() => expect(backend.listTimers).toHaveBeenCalledTimes(2));
});

it('says so when the timers cannot be loaded', async () => {
  backend.listTimers.mockRejectedValue(new Error('down'));
  renderAt(NOW);
  fireEvent.click(screen.getByRole('button', { name: 'Start a timer' }));
  expect(await screen.findByText('Could not load the kitchen timers.')).toBeInTheDocument();
});

it('starts a typed-in or quick timer from the tray, and stops a running one after asking', async () => {
  backend.listTimers.mockResolvedValue([row('Rice', 300)]);
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  renderAt(NOW);
  fireEvent.click(await screen.findByRole('button', { name: 'Start a timer' }));
  fireEvent.change(screen.getByLabelText('Timer name'), { target: { value: 'Tea' } });
  fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() =>
    expect(backend.addTimer).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Tea', duration_s: 240 })
    )
  );

  fireEvent.click(screen.getByRole('button', { name: 'Start a timer' }));
  fireEvent.click(screen.getByRole('button', { name: '5 min' }));
  await waitFor(() => expect(backend.addTimer).toHaveBeenCalledTimes(2));

  fireEvent.click(screen.getByRole('button', { name: /Rice, 5:00 left/ }));
  await waitFor(() => expect(backend.removeTimer).toHaveBeenCalledWith('Rice'));
});

it('shows a tray error when a timer could not start, and closes the form', async () => {
  backend.addTimer.mockRejectedValueOnce(new Error('offline'));
  renderAt(NOW);
  fireEvent.click(screen.getByRole('button', { name: 'Start a timer' }));
  fireEvent.click(screen.getByRole('button', { name: '1 min' }));
  expect(await screen.findByText(/Could not start that timer/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByLabelText('Minutes')).not.toBeInTheDocument();
});

it('ticks once a second on its own clock while timers exist', async () => {
  jest.useFakeTimers();
  backend.listTimers.mockResolvedValue([row('Rice', 100000)]);
  renderWithProviders(
    <TimersProvider>
      <Probe />
    </TimersProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(31000);
  });
  expect(backend.listTimers.mock.calls.length).toBeGreaterThanOrEqual(2);
  jest.useRealTimers();
});

it('needs a provider', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const Bare = () => {
    useTimers();
    return null;
  };
  expect(() => renderWithProviders(<Bare />)).toThrow(/TimersProvider/);
});

it('knows when it is inside Hive', () => {
  expect(insideHive()).toBe(false);
});

describe('StepTimer', () => {
  it('offers a timer for a step that says how long, and toggles it', async () => {
    renderAt(
      NOW,
      <StepTimer recipeId="r1" recipeName="Soup" index={1} text="Simmer for 20 minutes" />
    );
    fireEvent.click(await screen.findByRole('button', { name: /Start a 20 minute timer/ }));
    await waitFor(() =>
      expect(backend.addTimer).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'recipe:r1:1', label: 'Soup, step 2', duration_s: 1200 })
      )
    );
  });

  it('shows what is left, and Done once it rings', async () => {
    backend.listTimers.mockResolvedValue([
      row('a', 90, { key: 'recipe:r1:0' }),
      row('b', -1, { key: 'recipe:r1:2' }),
    ]);
    renderAt(
      NOW,
      <>
        <StepTimer recipeId="r1" index={0} text="Bake 10 min" />
        <StepTimer recipeId="r1" index={2} text="Rest 5 min" />
      </>
    );
    const step = await screen.findByRole('button', { name: /^1:30 left. Tap to stop/ });
    expect(screen.getByRole('button', { name: /Done. Tap to stop/ })).toBeInTheDocument();
    fireEvent.click(step);
    await waitFor(() => expect(backend.removeTimer).toHaveBeenCalledWith('a'));
  });

  it('stays out of the way for a step with no time, or outside the provider', () => {
    renderWithProviders(<StepTimer recipeId="r1" index={0} text="Bake 10 min" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    renderAt(NOW, <StepTimer recipeId="r1" index={0} text="Season well" />);
    expect(screen.queryByRole('button', { name: /minute timer/ })).not.toBeInTheDocument();
  });
});
