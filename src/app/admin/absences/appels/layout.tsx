import AttendanceMonitorAutoRefresh from "../../ui/attendance-monitor-auto-refresh";

export default function AttendanceMonitorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AttendanceMonitorAutoRefresh />
      {children}
    </>
  );
}
