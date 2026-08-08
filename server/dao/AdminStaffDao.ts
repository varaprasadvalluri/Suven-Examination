export interface StaffRecord {
  id: string;
  source: 'admins' | 'super_admins';
  data: any;
}

// Data-access contract for staff listing (`admins` + `super_admins` collections merged).
export interface AdminStaffDao {
  findAll(): Promise<StaffRecord[]>;
}
