// DOM Selectors
const DOM = {
    yearSelector: document.getElementById('yearSelector'),
    sessionSearch: document.getElementById('sessionSearch'),
    typeFilters: document.getElementById('typeFilters'),
    showCancelled: document.getElementById('showCancelled'),
    sessionsList: document.getElementById('sessionsList'),
    emptyState: document.getElementById('emptyState'),
    dashboardContent: document.getElementById('dashboardContent'),
    
    // Header
    headerFlag: document.getElementById('headerFlag'),
    headerYear: document.getElementById('headerYear'),
    headerLocation: document.getElementById('headerLocation'),
    headerGPName: document.getElementById('headerGPName'),
    headerSessionType: document.getElementById('headerSessionType'),
    
    // Weather
    weatherAirTemp: document.getElementById('weatherAirTemp'),
    weatherTrackTemp: document.getElementById('weatherTrackTemp'),
    weatherHumidity: document.getElementById('weatherHumidity'),
    weatherWind: document.getElementById('weatherWind'),
    weatherRainfall: document.getElementById('weatherRainfall'),
    
    // Drivers Grid
    driverSearch: document.getElementById('driverSearch'),
    driversGrid: document.getElementById('driversGrid'),
    
    // Laps/Stints Section
    lapsDriverList: document.getElementById('lapsDriverList'),
    lapsContent: document.getElementById('lapsContent'),
    lapsEmpty: document.getElementById('lapsEmpty'),
    lapsData: document.getElementById('lapsData'),
    statsColorBar: document.getElementById('statsColorBar'),
    statsDriverHeadshot: document.getElementById('statsDriverHeadshot'),
    statsDriverName: document.getElementById('statsDriverName'),
    statsDriverTeam: document.getElementById('statsDriverTeam'),
    statsDriverFlag: document.getElementById('statsDriverFlag'),
    statsDriverAge: document.getElementById('statsDriverAge'),
    statsDriverWiki: document.getElementById('statsDriverWiki'),
    statsDriverNumber: document.getElementById('statsDriverNumber'),
    statsFastestLap: document.getElementById('statsFastestLap'),
    statsTheoBestLap: document.getElementById('statsTheoBestLap'),
    statsAvgLap: document.getElementById('statsAvgLap'),
    statsTotalLaps: document.getElementById('statsTotalLaps'),
    stintsTimeline: document.getElementById('stintsTimeline'),
    chartHideOutliers: document.getElementById('chartHideOutliers'),
    lapsChartContainer: document.getElementById('lapsChartContainer'),
    lapsTableBody: document.getElementById('lapsTableBody'),
    telemetrySection: document.getElementById('telemetrySection'),
    telemetryLapSelect: document.getElementById('telemetryLapSelect'),
    telemetryStats: document.getElementById('telemetryStats'),
    telemetrySpeedChart: document.getElementById('telemetrySpeedChart'),
    telemetryInputsChart: document.getElementById('telemetryInputsChart'),

    // Compare Section
    compareDriverList: document.getElementById('compareDriverList'),
    compareChartContainer: document.getElementById('compareChartContainer'),
    compareLegend: document.getElementById('compareLegend'),
    compareHideOutliers: document.getElementById('compareHideOutliers'),
    compareResetZoom: document.getElementById('compareResetZoom'),
    compareSelectedCount: document.getElementById('compareSelectedCount'),
    compareChartToggles: document.getElementById('compareChartToggles'),
    compareLapTimesChartSection: document.getElementById('compareLapTimesChartSection'),
    compareGapChartSection: document.getElementById('compareGapChartSection'),
    compareGapChartContainer: document.getElementById('compareGapChartContainer'),
    comparePositionChartSection: document.getElementById('comparePositionChartSection'),
    comparePositionChartContainer: document.getElementById('comparePositionChartContainer'),
    compareHeadToHeadChartSection: document.getElementById('compareHeadToHeadChartSection'),
    compareHeadToHeadChartContainer: document.getElementById('compareHeadToHeadChartContainer'),
    compareHeadToHeadRef: document.getElementById('compareHeadToHeadRef'),
    compareTyreStrategyChartSection: document.getElementById('compareTyreStrategyChartSection'),
    compareTyreStrategyChartContainer: document.getElementById('compareTyreStrategyChartContainer'),
    
    // Circuit Details elements
    circuitOfficialName: document.getElementById('circuitOfficialName'),
    circuitShortName: document.getElementById('circuitShortName'),
    circuitLocation: document.getElementById('circuitLocation'),
    circuitCountry: document.getElementById('circuitCountry'),
    circuitType: document.getElementById('circuitType'),
    circuitGmtOffset: document.getElementById('circuitGmtOffset'),
    circuitStartDate: document.getElementById('circuitStartDate'),
    circuitEndDate: document.getElementById('circuitEndDate'),
    circuitMapContent: document.getElementById('circuitMapContent'),
    replayCard: document.getElementById('replayCard'),
    replayDriverSelect: document.getElementById('replayDriverSelect'),
    replayLapSelect: document.getElementById('replayLapSelect'),
    replayPlayBtn: document.getElementById('replayPlayBtn'),
    replayScrubber: document.getElementById('replayScrubber'),
    replayTimeLabel: document.getElementById('replayTimeLabel'),
    replaySpeedToggle: document.getElementById('replaySpeedToggle'),
    replayMapContent: document.getElementById('replayMapContent'),
    
    // Results
    resultsTableBody: document.getElementById('resultsTableBody'),
    resultsTableWrapper: document.getElementById('resultsTableWrapper'),
    resultsEmptyState: document.getElementById('resultsEmptyState'),
    resultsEmptyTitle: document.getElementById('resultsEmptyTitle'),
    resultsEmptyText: document.getElementById('resultsEmptyText'),
    raceStandingsWrapper: document.getElementById('raceStandingsWrapper'),
    raceStandingsSummary: document.getElementById('raceStandingsSummary'),
    driverStandingsTableBody: document.getElementById('driverStandingsTableBody'),
    constructorStandingsTableBody: document.getElementById('constructorStandingsTableBody'),
    progressionWrapper: document.getElementById('progressionWrapper'),
    progressionSummary: document.getElementById('progressionSummary'),
    progressionChartContainer: document.getElementById('progressionChartContainer'),
    progressionDriversBtn: document.getElementById('progressionDriversBtn'),
    progressionConstructorsBtn: document.getElementById('progressionConstructorsBtn'),

    // Race Control
    raceControlFeed: document.getElementById('raceControlFeed'),
    raceControlEmptyState: document.getElementById('raceControlEmptyState'),
    raceControlSummary: document.getElementById('raceControlSummary'),
    showBlueFlags: document.getElementById('showBlueFlags'),
    
    // Tabs
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabViews: document.querySelectorAll('.tab-view')
};

let compareInteractionContexts = [];

