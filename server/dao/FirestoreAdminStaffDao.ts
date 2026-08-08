import { clientDb, clientCollection, clientGetDocs } from '../firestoreClient';
import { AdminStaffDao, StaffRecord } from './AdminStaffDao';

export class FirestoreAdminStaffDao implements AdminStaffDao {
  async findAll(): Promise<StaffRecord[]> {
    const [adminsSnap, superAdminsSnap] = await Promise.all([
      clientGetDocs(clientCollection(clientDb, 'admins')),
      clientGetDocs(clientCollection(clientDb, 'super_admins'))
    ]);

    return [
      ...adminsSnap.docs.map((doc: any) => ({ id: doc.id, source: 'admins' as const, data: doc.data() })),
      ...superAdminsSnap.docs.map((doc: any) => ({ id: doc.id, source: 'super_admins' as const, data: doc.data() }))
    ];
  }
}

export const adminStaffDao: AdminStaffDao = new FirestoreAdminStaffDao();
