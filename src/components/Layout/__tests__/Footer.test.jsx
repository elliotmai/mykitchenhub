// The footer is where a user reads which build they're on, and where they go
// to report a bug. Both need to keep working.

import React from 'react';
import { render, screen } from '@testing-library/react';

import Footer from '../Footer';
import { APP_VERSION, ROADMAP_STEP, ROADMAP_STEP_NAME } from '../../../config/version';

describe('Footer', () => {
  it('shows the current app version', () => {
    render(<Footer />);
    expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument();
  });

  it('reads the version from config rather than a hardcoded literal', () => {
    const { container } = render(<Footer />);
    // Exactly one version node, and it agrees with config — a stale literal
    // left behind after a bump would show up as a second, mismatched string.
    const versions = [...container.querySelectorAll('.app-footer__version')];
    expect(versions).toHaveLength(1);
    expect(versions[0]).toHaveTextContent(`v${APP_VERSION}`);
  });

  it('explains which roadmap step the build corresponds to', () => {
    render(<Footer />);
    expect(screen.getByText(`v${APP_VERSION}`)).toHaveAttribute(
      'title',
      `Roadmap step ${ROADMAP_STEP} — ${ROADMAP_STEP_NAME}`
    );
  });

  it('shows the current year in the copyright', () => {
    render(<Footer />);
    expect(screen.getByText(new RegExp(String(new Date().getFullYear())))).toBeInTheDocument();
  });

  it('links out to the bug reporting site safely', () => {
    render(<Footer />);

    const link = screen.getByRole('link', { name: /report a bug or request a feature/i });
    expect(link).toHaveAttribute('href', 'https://ticketbooth.netlify.app/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
