import { create } from 'zustand'
import { persist } from 'zustand/middleware'


export const useConfig = create(
  persist(
    set => ({
      config: {},
      setConfig: (key: string, value: any) => set(
        state => ({config: {...state.config, [key]: value}})
      )
    }),
    {
      name: 'global-config'
    }
  )
)


export const useHistory = create((set) => ({
  history: [],
  addHistory: (path) => set((state) => ({ history: [...state.history, path] })),
  removeLastHistory: () => set((state) => ({ history: state.history.slice(0, -1) })),
}));
