import { StatusBar } from 'expo-status-bar';
import { PlaceholderScreen } from '@servisapp/ui';
import { apiUrl } from './src/api/client';

export default function App() {
  return (
    <>
      <PlaceholderScreen
        title="ServisApp Personel"
        body="Altyapı hazır. Sefer ekranı ve çevrimdışı kuyruk Faz 5'te bu API'ye bağlanır."
        meta={apiUrl('/v1/config')}
      />
      <StatusBar style="light" />
    </>
  );
}
