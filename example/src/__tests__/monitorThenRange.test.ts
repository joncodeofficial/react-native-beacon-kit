import { describe, expect, it, jest } from '@jest/globals';
import {
  handleMonitorThenRangeStateChange,
  type MonitorThenRangeRegion,
} from '../monitorThenRange';

describe('handleMonitorThenRangeStateChange', () => {
  const region: MonitorThenRangeRegion = {
    identifier: 'test-region',
    uuid: 'a1b23c45-d67e-9fab-de12-0034567890ab',
    major: 1,
    minor: 2,
  };

  it('sets the region state and starts ranging when entering the region', async () => {
    const setRegionState = jest.fn<(state: 'inside' | 'outside') => void>();
    const clearBeacons = jest.fn<() => void>();
    const startRanging =
      jest.fn<(target: MonitorThenRangeRegion) => Promise<void>>();
    const stopRanging =
      jest.fn<(target: MonitorThenRangeRegion) => Promise<void>>();

    startRanging.mockResolvedValue();
    stopRanging.mockResolvedValue();

    await handleMonitorThenRangeStateChange('inside', region, {
      setRegionState,
      clearBeacons,
      startRanging,
      stopRanging,
    });

    expect(setRegionState).toHaveBeenCalledWith('inside');
    expect(startRanging).toHaveBeenCalledWith(region);
    expect(stopRanging).not.toHaveBeenCalled();
    expect(clearBeacons).not.toHaveBeenCalled();
  });

  it('stops ranging and clears beacons when leaving the region', async () => {
    const setRegionState = jest.fn<(state: 'inside' | 'outside') => void>();
    const clearBeacons = jest.fn<() => void>();
    const startRanging =
      jest.fn<(target: MonitorThenRangeRegion) => Promise<void>>();
    const stopRanging =
      jest.fn<(target: MonitorThenRangeRegion) => Promise<void>>();

    startRanging.mockResolvedValue();
    stopRanging.mockResolvedValue();

    await handleMonitorThenRangeStateChange('outside', region, {
      setRegionState,
      clearBeacons,
      startRanging,
      stopRanging,
    });

    expect(setRegionState).toHaveBeenCalledWith('outside');
    expect(stopRanging).toHaveBeenCalledWith(region);
    expect(clearBeacons).toHaveBeenCalledTimes(1);
    expect(startRanging).not.toHaveBeenCalled();
  });
});
