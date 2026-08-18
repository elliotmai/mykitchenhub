// src/components/Common/__tests__/ChipFilter.test.jsx

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ChipFilter from '../ChipFilter';

const manyTags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);

describe('ChipFilter', () => {
  it('renders nothing at all when there is nothing to filter by', () => {
    const { container } = render(<ChipFilter options={[]} selected={[]} onToggle={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every chip when they fit', () => {
    render(<ChipFilter options={['a', 'b', 'c']} selected={[]} onToggle={jest.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });

  it('folds the tail away and says how many are hidden', () => {
    render(<ChipFilter options={manyTags} selected={[]} onToggle={jest.fn()} visibleCount={12} />);
    expect(screen.getByText('tag-11')).toBeInTheDocument();
    expect(screen.queryByText('tag-12')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+8 more' })).toBeInTheDocument();
  });

  it('reveals the rest, and folds them back', async () => {
    const user = userEvent.setup();
    render(<ChipFilter options={manyTags} selected={[]} onToggle={jest.fn()} visibleCount={12} />);

    await user.click(screen.getByRole('button', { name: '+8 more' }));
    expect(screen.getByText('tag-19')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.queryByText('tag-19')).not.toBeInTheDocument();
  });

  // The one that matters: a filter you cannot see is a filter you cannot undo.
  it('keeps a selected chip on screen even when it falls in the hidden tail', () => {
    render(
      <ChipFilter options={manyTags} selected={['tag-18']} onToggle={jest.fn()} visibleCount={12} />
    );
    expect(screen.getByText('tag-18')).toBeInTheDocument();
    expect(screen.getByText('tag-18')).toHaveAttribute('aria-pressed', 'true');
    // It is shown in addition to the first twelve, not instead of one of them.
    expect(screen.getByText('tag-0')).toBeInTheDocument();
    expect(screen.getByText('tag-11')).toBeInTheDocument();
  });

  it('reports the pressed state, and toggles on click', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    render(<ChipFilter options={['dinner', 'quick']} selected={['dinner']} onToggle={onToggle} />);

    expect(screen.getByText('dinner')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('quick')).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByText('quick'));
    expect(onToggle).toHaveBeenCalledWith('quick');
  });

  it('names the group for anyone navigating by landmark', () => {
    render(<ChipFilter options={['a']} selected={[]} onToggle={jest.fn()} label="Filter by tag" />);
    expect(screen.getByRole('group', { name: 'Filter by tag' })).toBeInTheDocument();
  });
});
