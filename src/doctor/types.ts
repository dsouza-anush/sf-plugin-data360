export type DoctorStatus = 'pass' | 'warn' | 'fail';

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  detail: string;
  action?: string;
};

export type DoctorResult = { checks: DoctorCheck[] };

export type DataSpace = {
  id?: string;
  name: string;
  label?: string;
  status?: string;
  description?: string;
};
