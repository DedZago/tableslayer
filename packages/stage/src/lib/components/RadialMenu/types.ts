// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IconComponent = any;

export interface RadialMenuItemProps {
  id: string;
  /** Always shown under the button */
  label: string;
  /** One line shown in the hub while the option is pressed or hovered */
  hint?: string;
  icon?: IconComponent;
  /** Color-only button (a swatch), e.g. a drawing color */
  color?: string;
  /** AnnotationEffect enum value for an animated effect preview */
  effectType?: number;
  /** Tints the icon; an active option is filled with it */
  accent?: string;
  /** Shown as on (a condition the token has) */
  active?: boolean;
  /** Small count or text on the button's corner */
  badge?: string | number;
  /** Destructive option (delete) */
  danger?: boolean;
  /** Selecting it keeps the menu open, for toggles picked several in a row */
  keepOpen?: boolean;
  submenu?: RadialMenuItemProps[];
  disabled?: boolean;
}

export interface RadialMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  items: RadialMenuItemProps[];
  /** Hub text at the top level: what the menu acts on ("Goblin", "Map") */
  title?: string;
  /** Hub second line at the top level */
  subtitle?: string;
  backIcon?: IconComponent;
  closeIcon?: IconComponent;
  /** Closes the menu after this long without input */
  autoCloseMs?: number;
  onItemSelect?: (itemId: string) => void;
  /** A submenu ring was opened; lets the app warm up what its options will need */
  onSubmenuOpen?: (itemId: string) => void;
  onClose?: () => void;
  onReposition?: (position: { x: number; y: number }) => void;
  /** Degrees the menu opens at; when undefined it opens facing the nearest screen edge */
  rotation?: number;
  /** Called with the rotation in [0, 360) when a twist ends, and when the nearest edge was used on open */
  onRotationChange?: (rotation: number) => void;
}
