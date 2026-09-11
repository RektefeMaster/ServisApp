export { exhaustive } from './exhaustive.js';
export {
  ACTOR_ROLES,
  DELIVERY_TARGETS,
  OPERATIONAL_FACT_STATES,
  STATES_BLOCKING_COMPLETION,
  STATES_OCCUPYING_VEHICLE,
  STUDENT_STATES,
  TRIP_STATES,
  blocksCompletion,
  isOperationalFact,
  occupiesVehicle,
  type ActorRole,
  type DeliveryTarget,
  type StudentState,
  type TripState,
} from './states.js';
export {
  STUDENT_ACTIONS,
  applyStudentAction,
  studentActionTargetState,
  type RejectionReason,
  type StudentAction,
  type StudentTransitionInput,
  type TransitionResult,
} from './student-state-machine.js';
export {
  canTransitionTrip,
  type TripRejectionReason,
  type TripTransitionInput,
  type TripTransitionResult,
} from './trip-state-machine.js';
export {
  EXCEPTION_INPUTS,
  reconcileStudent,
  type ExceptionInput,
  type ReconcileOutcome,
} from './reconcile.js';
export {
  checkCapacity,
  countsTowardCapacity,
  peakOccupancy,
  type CapacityCheck,
  type StopOccupancyChange,
} from './capacity.js';
export { compareSemver, isAppVersionSupported, parseSemver } from './app-version.js';
export { haversineMeters, type LatLng } from './haversine.js';
export { pickStudentAnchorStop, type StudentAnchorStop } from './student-anchor.js';
export {
  evaluateRouteCapacity,
  evaluateRoutePlan,
  occupancyForSegment,
  type RoutePlanIssue,
  type RoutePlanResult,
  type RoutePlanStop,
  type RouteSegment,
  type StopKind,
} from './route-plan.js';
export {
  suggestWaypointOrder,
  type SchoolAnchor,
  type TravelCost,
  type Waypoint,
} from './waypoint-order.js';
export {
  AFTERNOON_DEPARTURE_HOUR,
  MORNING_DEPARTURE_HOUR,
  TRIP_HORIZON_DAYS,
  deliveryTargetForSegment,
  expectedStopKind,
  horizonDatesFrom,
  horizonServiceDates,
  plannedDepartureAt,
  ymdInTimeZone,
  zonedDayEnd,
  zonedDayStart,
  type HorizonSegment,
} from './trip-horizon.js';
export {
  crewActionsForStudent,
  pendingStudentsAtStop,
  resumeOpenTrip,
  tripFocus,
  tripGate,
  type CrewSegment,
  type CrewStop,
  type CrewStudent,
  type CrewTripView,
  type TripFocus,
  type TripGate,
} from './crew-focus.js';
export { namesLikelySame, normalizePersonName } from './person-name.js';
export {
  STUDENT_PLAN_STATUSES,
  segmentPlanStatus,
  type SegmentPlanInput,
  type StudentPlanStatus,
} from './plan-status.js';
export { canReadGuardianChild, type GuardianChildAccessInput } from './guardian-access.js';
export {
  hasUsableCoordinates,
  tripReadyCrewBlock,
  type TripReadyBlock,
} from './publish-ready.js';
export {
  applyOptimistic,
  applyServerResult,
  asStudentState,
  dropPendingForStudent,
  nextDeviceSeq,
  nextFlushBatch,
  recoverInFlight,
  reconcileStudentFromServer,
  type CommandServerResult,
  type OutboxItem,
  type OutboxStatus,
} from './command-outbox.js';
export {
  GPS_ACCURACY_LOW_M,
  GPS_ACCURACY_REJECT_M,
  GPS_AUTH_REASONS,
  GPS_JUMP_REJECT_M,
  GPS_MAX_SPEED_MPS,
  GPS_REJECT_REASONS,
  LOCATION_QUALITIES,
  PING_ARCHIVE_INTERVAL_MS,
  evaluateGpsQuality,
  gpsAuthMessage,
  gpsRejectMessage,
  shouldArchivePing,
  type GpsAuthReason,
  type GpsQualityVerdict,
  type GpsRejectReason,
  type GpsSample,
  type LastGoodFix,
  type LocationQuality,
} from './gps-quality.js';
export {
  GPS_WATCHDOG_STATES,
  gpsWatchdog,
  gpsWatchdogCrewMessage,
  gpsWatchdogParentMessage,
  liveLocationAvailable,
  type GpsWatchdogState,
} from './gps-watchdog.js';
export {
  MAX_ROUTES_CALLS_PER_TRIP,
  MIN_ROUTE_REFRESH_INTERVAL_MS,
  OFF_ROUTE_REFRESH_M,
  ROUTES_MAX_POINTS_PER_REQUEST,
  URBAN_BUS_SPEED_MPS,
  assembleSequentialOffsets,
  chunkRoutePoints,
  chunkedHaversineBaseline,
  distanceToPolylineM,
  haversineBaseline,
  mergeChunkLegs,
  shouldRefreshRoutes,
  type BaselineChunk,
  type BaselineLeg,
  type RouteBaseline,
  type RoutePoint,
} from './route-baseline.js';
export {
  DEFAULT_APPROACH_MINUTES,
  SEGMENT_STAT_MIN_SAMPLES,
  blendSegmentSeconds,
  delayFactor,
  describeEtaConfidence,
  etaConfidence,
  formatParentEta,
  remainingEtaSeconds,
  shouldNotifyApproach,
  type EtaStop,
  type ObservedLeg,
  type ParentEtaPhrase,
} from './eta.js';
export { easeInOutCubic, interpolateLngLat } from './marker-interpolate.js';
export {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS,
  canResendOtp,
  criticalAlertAutoDropped,
  detourDecision,
  otpLockedAfterAttempts,
  reconcileCancelRideException,
  type DetourDecision,
} from './detour.js';
export {
  TRACKING_OPEN_STUDENT_STATES,
  parentCanTrack,
  sharedTrackingPayload,
  studentStillTracked,
  tripBroadcastOpen,
  type SharedVehicleBroadcast,
} from './tracking-access.js';
