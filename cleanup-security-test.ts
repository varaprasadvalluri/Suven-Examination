import './server/loadEnv';
import { clientDb, clientDoc, clientDeleteDoc } from './server/firestoreClient';

async function main() {
  await clientDeleteDoc(clientDoc(clientDb, 'users', 'edu-usr-fc73396a75e6-mt5k593o'));
  await clientDeleteDoc(clientDoc(clientDb, 'attempts', 'att_nonexistent-exam-for-test_edu-usr-fc73396a75e6-mt5k593o'));
  console.log('Cleaned up test docs.');
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
