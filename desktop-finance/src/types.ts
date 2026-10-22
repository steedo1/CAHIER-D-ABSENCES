export type School = {
  school_id: string;
  school_name: string;
  academic_year: string;
};

export type Student = {
  id: string;
  matricule: string;
  full_name: string;
  class_name: string;
};

export type Charge = {
  id: string;
  student_id: string;
  label: string;
  amount_fcfa: number;
  paid_fcfa: number;
};

export type Payment = {
  id: string;
  charge_id: string;
  amount_fcfa: number;
  receipt_no: string;
  created_at: string;
  sync_status: string;
};

export type Overview = {
  school: School | null;
  students: Student[];
  charges: Charge[];
  payments: Payment[];
  pending_events: number;
};
