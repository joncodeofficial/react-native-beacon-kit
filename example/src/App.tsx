import { useEffect, useState } from 'react';
import { Button, StyleSheet, View } from 'react-native';
import MonitorThenRangeExample from './MonitorThenRangeExample';
import TestScreen from './TestScreen';
import { initializeBeaconExample } from './beaconSetup';

const App = () => {
  const [screen, setScreen] = useState<'basics' | 'monitor'>('basics');

  useEffect(() => {
    initializeBeaconExample().catch((error: unknown) => {
      console.warn('[beacon] example initialization failed', error);
    });
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Button
          title="Basics"
          onPress={() => setScreen('basics')}
          color={screen === 'basics' ? '#007aff' : '#aaa'}
        />
        <Button
          title="Monitor + Range"
          onPress={() => setScreen('monitor')}
          color={screen === 'monitor' ? '#007aff' : '#aaa'}
        />
      </View>
      {screen === 'basics' ? <TestScreen /> : <MonitorThenRangeExample />}
    </View>
  );
};

export default App;

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 52,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
});
