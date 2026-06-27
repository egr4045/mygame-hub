import { create } from 'zustand';

export interface MenuItem {
  /** Omitted for separator rows. */
  label?: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
}

interface MenuState {
  menu: {
    x: number;
    y: number;
    items: MenuItem[];
  } | null;
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeMenu: () => void;
}

export const useMenuStore = create<MenuState>((set) => ({
  menu: null,
  openMenu: (x, y, items) => set({ menu: { x, y, items } }),
  closeMenu: () => set({ menu: null }),
}));
