import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/KeyboardAwareScrollViewCompat', () => ({
  KeyboardAwareScrollViewCompat: ({ children }: { children: any }) => {
    const React = require('react');
    return React.createElement(React.Fragment, null, children);
  },
}));

import { useAuth } from '@/contexts/AuthContext';
import RegisterCustomerScreen from '@/app/(tabs)/auth/register-customer';
import RegisterTraderScreen from '@/app/(tabs)/auth/register-trader';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const customerData = {
  fullName: 'Alex Customer',
  email: 'alex@example.com',
  password: 'password123',
  confirmPassword: 'password123',
};

function fillCustomer() {
  fireEvent.changeText(screen.getByPlaceholderText('John Doe'), customerData.fullName);
  fireEvent.changeText(screen.getByPlaceholderText('you@example.com'), customerData.email);
  fireEvent.changeText(screen.getByPlaceholderText('Create a secure password'), customerData.password);
  fireEvent.changeText(screen.getByPlaceholderText('Re-enter your password'), customerData.confirmPassword);
}

describe('registration age and legal-capacity declaration', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows an accessible customer declaration and blocks registration until accepted', async () => {
    const registerCustomer = jest.fn().mockResolvedValue({
      email: customerData.email,
      pollToken: 'poll-token',
    });
    mockUseAuth.mockReturnValue({ registerCustomer } as unknown as ReturnType<typeof useAuth>);

    render(<RegisterCustomerScreen />);

    const declaration = screen.getByRole('checkbox', {
      name: /at least 18.*legally able to enter service arrangements/i,
    });
    expect(declaration).toBeTruthy();
    expect(screen.getByText('No date of birth is collected.')).toBeTruthy();
    const registerButton = screen.getByText('Register');

    fillCustomer();
    fireEvent.press(registerButton);
    expect(registerCustomer).not.toHaveBeenCalled();

    fireEvent.press(declaration);
    await act(async () => {
      fireEvent.press(screen.getByText('Register'));
    });

    expect(registerCustomer).toHaveBeenCalledWith({
      fullName: customerData.fullName,
      email: customerData.email,
      password: customerData.password,
      phone: undefined,
      ageLegalCapacityAccepted: true,
    });
  });

  it('keeps trader Terms/Privacy acceptance and blocks until the age declaration is accepted', async () => {
    const registerTrader = jest.fn().mockResolvedValue({
      email: 'trader@example.com',
      pollToken: 'poll-token',
    });
    mockUseAuth.mockReturnValue({ registerTrader } as unknown as ReturnType<typeof useAuth>);

    render(<RegisterTraderScreen />);

    const checkboxes = screen.getAllByRole('checkbox');
    const termsCheckbox = checkboxes[0];
    const declaration = screen.getByRole('checkbox', {
      name: /at least 18.*legally able to enter service arrangements/i,
    });
    expect(declaration).toBeTruthy();
    expect(screen.getByText('No date of birth is collected.')).toBeTruthy();
    const registerButton = screen.getByText('Create Trader Account');

    const values: Record<string, string> = {
      'Start typing your registered company name': 'Acme Plumbing Ltd',
      'e.g. Plumber, Electrician': 'Plumber',
      'e.g. 12 High Street': '12 High Street',
      London: 'London',
      'EC1A 1BB': 'EC1A 1BB',
      'John Smith': 'Alex Trader',
      'you@business.com': 'trader@example.com',
      '07700 900000': '07700 900001',
      'Create a secure password': 'password123',
      'Re-enter your password': 'password123',
    };
    Object.entries(values).forEach(([placeholder, value]) => {
      fireEvent.changeText(screen.getByPlaceholderText(placeholder), value);
    });

    fireEvent.press(termsCheckbox);
    fireEvent.press(registerButton);
    expect(registerTrader).not.toHaveBeenCalled();

    fireEvent.press(declaration);
    await act(async () => {
      fireEvent.press(screen.getByText('Create Trader Account'));
    });

    expect(registerTrader).toHaveBeenCalledWith(expect.objectContaining({
      termsAccepted: true,
      privacyAccepted: true,
      ageLegalCapacityAccepted: true,
      businessName: 'Acme Plumbing Ltd',
      contactName: 'Alex Trader',
      email: 'trader@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    }));
  });
});