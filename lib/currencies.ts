export const SUPPORTED_CURRENCIES = [
  { code: "USD", label: "USD — US Dollar" },
  { code: "INR", label: "INR — Indian Rupee" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
] as const;

export const isSupportedCurrency = (value: string): value is typeof SUPPORTED_CURRENCIES[number]["code"] => SUPPORTED_CURRENCIES.some((currency) => currency.code === value);
