export type MonitorThenRangeState = 'inside' | 'outside';

export interface MonitorThenRangeRegion {
  identifier: string;
  uuid: string;
  major?: number;
  minor?: number;
}

export interface MonitorThenRangeDependencies<
  TRegion extends MonitorThenRangeRegion,
> {
  setRegionState: (state: MonitorThenRangeState) => void;
  clearBeacons: () => void;
  startRanging: (region: TRegion) => Promise<void>;
  stopRanging: (region: TRegion) => Promise<void>;
}

export const handleMonitorThenRangeStateChange = async <
  TRegion extends MonitorThenRangeRegion,
>(
  state: MonitorThenRangeState,
  region: TRegion,
  dependencies: MonitorThenRangeDependencies<TRegion>
) => {
  dependencies.setRegionState(state);

  if (state === 'inside') {
    await dependencies.startRanging(region);
    return;
  }

  const stopPromise = dependencies.stopRanging(region);
  dependencies.clearBeacons();
  await stopPromise;
};
