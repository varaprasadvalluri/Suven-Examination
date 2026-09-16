import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FieldError } from './field-error';

describe('FieldError', () => {
  it('renders nothing when there is no message', () => {
    const { container } = render(<FieldError id="email-error" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the message and carries the id the input points at', () => {
    render(<FieldError id="email-error" message="Enter a valid email address." />);

    // role="alert" is what makes the message announced the moment it appears; the id is what
    // ties it to the input via aria-describedby. Both are the point of the component.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid email address.');
    expect(alert).toHaveAttribute('id', 'email-error');
  });
});
