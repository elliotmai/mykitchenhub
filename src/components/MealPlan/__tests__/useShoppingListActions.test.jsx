// The shopping list's write handlers.
//
// These used to live inline in MealPlanView and were covered only through it.
// The list has two surfaces now and they share this, so it is tested directly:
// what a cook sees when a write fails, and which row shows as busy while it is
// in flight, are the things that must not differ between the two screens.

import { act, renderHook, waitFor } from '@testing-library/react';

import { useShoppingListActions } from '../useShoppingListActions';

const mockShoppingList = {
  addItem: jest.fn(),
  updateItem: jest.fn(),
  setBought: jest.fn(),
  removeItem: jest.fn(),
  clearBought: jest.fn(),
};

const mockShowError = jest.fn();
const mockShowInfo = jest.fn();

jest.mock('../../../hooks/useShoppingList', () => ({
  __esModule: true,
  default: () => mockShoppingList,
}));

jest.mock('../../Common', () => ({
  __esModule: true,
  useToast: () => ({ showError: mockShowError, showInfo: mockShowInfo, showSuccess: jest.fn() }),
}));

const render = () => renderHook(() => useShoppingListActions());

const OK = { success: true };
const FAILED = { success: false, error: 'Firestore said no' };

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(mockShoppingList).forEach((fn) => fn.mockResolvedValue(OK));
});

describe('onAddItem', () => {
  it('hands the result back so the form can clear itself', async () => {
    const { result } = render();
    let outcome;
    await act(async () => {
      outcome = await result.current.onAddItem({ name: 'Milk' });
    });
    expect(outcome).toEqual(OK);
  });

  it('says what went wrong rather than failing silently', async () => {
    mockShoppingList.addItem.mockResolvedValue(FAILED);
    const { result } = render();
    await act(async () => {
      await result.current.onAddItem({ name: 'Milk' });
    });
    expect(mockShowError).toHaveBeenCalledWith('Firestore said no');
  });

  it('falls back to a sentence when the error carries none', async () => {
    mockShoppingList.addItem.mockResolvedValue({ success: false });
    const { result } = render();
    await act(async () => {
      await result.current.onAddItem({ name: 'Milk' });
    });
    expect(mockShowError).toHaveBeenCalledWith(expect.stringMatching(/shopping list/i));
  });
});

describe('onToggleBought', () => {
  it('ticks an item off', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.onToggleBought({ id: 'a', name: 'Milk' }, true);
    });
    expect(mockShoppingList.setBought).toHaveBeenCalledWith('a', true);
  });

  it('clears the busy row once the write settles', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.onToggleBought({ id: 'a', name: 'Milk' }, true);
    });
    await waitFor(() => expect(result.current.busyItemId).toBeNull());
  });

  it('reports a refusal', async () => {
    mockShoppingList.setBought.mockResolvedValue(FAILED);
    const { result } = render();
    await act(async () => {
      await result.current.onToggleBought({ id: 'a', name: 'Milk' }, true);
    });
    expect(mockShowError).toHaveBeenCalledWith('Firestore said no');
  });
});

describe('onEditItem', () => {
  it('saves the change', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.onEditItem({ id: 'a', name: 'Mlik' }, { name: 'Milk' });
    });
    expect(mockShoppingList.updateItem).toHaveBeenCalledWith('a', { name: 'Milk' });
  });

  // The row uses this to decide whether to close; losing it would throw away
  // a correction the cook just typed.
  it('hands the result back', async () => {
    mockShoppingList.updateItem.mockResolvedValue(FAILED);
    const { result } = render();
    let outcome;
    await act(async () => {
      outcome = await result.current.onEditItem({ id: 'a', name: 'Mlik' }, { name: '' });
    });
    expect(outcome).toEqual(FAILED);
    expect(mockShowError).toHaveBeenCalledWith('Firestore said no');
  });
});

describe('onRemoveItem', () => {
  it('says what left the list, by name', async () => {
    const { result } = render();
    await act(async () => {
      await result.current.onRemoveItem({ id: 'a', name: 'Milk' });
    });
    expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining('Milk'));
  });

  it('reports a refusal instead', async () => {
    mockShoppingList.removeItem.mockResolvedValue(FAILED);
    const { result } = render();
    await act(async () => {
      await result.current.onRemoveItem({ id: 'a', name: 'Milk' });
    });
    expect(mockShowError).toHaveBeenCalledWith('Firestore said no');
    expect(mockShowInfo).not.toHaveBeenCalled();
  });
});

describe('onClearBought', () => {
  it('says how many went', async () => {
    mockShoppingList.clearBought.mockResolvedValue({ success: true, cleared: 3 });
    const { result } = render();
    await act(async () => {
      await result.current.onClearBought();
    });
    expect(mockShowInfo).toHaveBeenCalledWith(expect.stringContaining('3'));
  });

  it('stays quiet when there was nothing to clear', async () => {
    mockShoppingList.clearBought.mockResolvedValue({ success: true, cleared: 0 });
    const { result } = render();
    await act(async () => {
      await result.current.onClearBought();
    });
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it('reports a refusal', async () => {
    mockShoppingList.clearBought.mockResolvedValue(FAILED);
    const { result } = render();
    await act(async () => {
      await result.current.onClearBought();
    });
    expect(mockShowError).toHaveBeenCalledWith('Firestore said no');
  });
});
