import { StatusBar } from 'expo-status-bar';
import { PlaceholderScreen } from '@servisapp/ui';
import { apiUrl } from './src/api/client';

export default function App() {
  return (
    <>
      <PlaceholderScreen
        title="ServisApp Veli"
        body="Altyapı hazır. Giriş ve canlı takip Faz 6'da bu API'ye bağlanır."
        meta={apiUrl('/v1/config')}
      />
      <StatusBar style="light" />
    </>
  );
}
