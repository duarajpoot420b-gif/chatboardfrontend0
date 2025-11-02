declare module "react-phone-input-2" {
  import { Component } from "react";

  interface PhoneInputProps {
    country?: string;
    value?: string;
    onChange?: (value: string, data?: any, event?: any, formattedValue?: string) => void;
    inputStyle?: React.CSSProperties;
    buttonStyle?: React.CSSProperties;
    dropdownStyle?: React.CSSProperties;
  }

  export default class PhoneInput extends Component<PhoneInputProps> {}
}
