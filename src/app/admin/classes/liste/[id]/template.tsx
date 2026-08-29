import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function ClassListTemplate({ children }: Props) {
  return (
    <>
      {children}
      <style>{`
        .screen-toolbar.mx-auto.mb-4.flex.max-w-6xl.flex-col
          > div:first-child
          > .text-sm.text-slate-600 {
          display: none !important;
        }
      `}</style>
    </>
  );
}
