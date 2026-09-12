import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandingPanel } from './BrandingPanel';

// This markup was duplicated character-for-character across LoginPage and StudentLinkEntry.
// Now that one component backs both, a change here silently changes both screens — so the
// brand copy and the published statistics are pinned.
describe('BrandingPanel', () => {
  it('renders the product identity', () => {
    render(<BrandingPanel />);
    expect(screen.getByText('SUVEN EDU')).toBeInTheDocument();
    expect(screen.getByText('EXAM PORTAL')).toBeInTheDocument();
    expect(screen.getByText('WELCOME BACK')).toBeInTheDocument();
    expect(screen.getByText('simplified.')).toBeInTheDocument();
  });

  it('renders the three published statistics', () => {
    render(<BrandingPanel />);
    for (const [value, label] of [
      ['12,400+', 'Students'],
      ['340+', 'Teachers'],
      ['98%', 'Satisfaction']
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/Trusted by 50\+ schools nationwide/)).toBeInTheDocument();
  });
});
