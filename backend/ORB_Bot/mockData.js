// Make sure to update the timestamps to match the timezone of your data source
// LONG
const mock5MinBars = [
  // ORB window (9:30-9:45 ET)
  { Timestamp: '2025-06-16T13:30:00Z', OpenPrice: 180, HighPrice: 182, LowPrice: 179, ClosePrice: 181, Volume: 1200000 },
  { Timestamp: '2025-06-16T13:35:00Z', OpenPrice: 181, HighPrice: 183, LowPrice: 180.5, ClosePrice: 182.5, Volume: 950000 },
  { Timestamp: '2025-06-16T13:40:00Z', OpenPrice: 182.5, HighPrice: 184, LowPrice: 182, ClosePrice: 183.7, Volume: 870000 },
  { Timestamp: '2025-06-16T13:45:00Z', OpenPrice: 183.7, HighPrice: 184.2, LowPrice: 182.8, ClosePrice: 183.2, Volume: 800000 },
  // Post-ORB bars (aggregates of 5 1-min bars below)
  { Timestamp: '2025-06-16T13:50:00Z', OpenPrice: 183.2, HighPrice: 185, LowPrice: 183, ClosePrice: 184.8, Volume: 700000 },
  { Timestamp: '2025-06-16T13:55:00Z', OpenPrice: 184.8, HighPrice: 186.5, LowPrice: 184.5, ClosePrice: 188.5, Volume: 900000 }, // Increased volume for breakout
  { Timestamp: '2025-06-16T14:00:00Z', OpenPrice: 188.5, HighPrice: 189, LowPrice: 187.5, ClosePrice: 188.8, Volume: 600000 },
  { Timestamp: '2025-06-16T14:05:00Z', OpenPrice: 188.8, HighPrice: 189.3, LowPrice: 187.7, ClosePrice: 188.9, Volume: 550000 },
  { Timestamp: '2025-06-16T14:10:00Z', OpenPrice: 188.9, HighPrice: 189.5, LowPrice: 188.2, ClosePrice: 189.2, Volume: 500000 },
  // Additional 5-min bars
  { Timestamp: '2025-06-16T14:15:00Z', OpenPrice: 189.2, HighPrice: 190, LowPrice: 188.7, ClosePrice: 189.7, Volume: 480000 },
  { Timestamp: '2025-06-16T14:20:00Z', OpenPrice: 189.7, HighPrice: 191, LowPrice: 189.5, ClosePrice: 190.8, Volume: 470000 },
  { Timestamp: '2025-06-16T14:25:00Z', OpenPrice: 190.8, HighPrice: 191.5, LowPrice: 190.2, ClosePrice: 191.2, Volume: 460000 },
  { Timestamp: '2025-06-16T14:30:00Z', OpenPrice: 191.2, HighPrice: 192, LowPrice: 190.8, ClosePrice: 191.8, Volume: 450000 },
  { Timestamp: '2025-06-16T14:35:00Z', OpenPrice: 191.8, HighPrice: 192.5, LowPrice: 191.3, ClosePrice: 192.3, Volume: 440000 },
];

const mock1MinBars = [
  // ...existing 1-min bars...
  { Timestamp: '2025-06-16T13:50:00Z', OpenPrice: 183.2, HighPrice: 183.8, LowPrice: 183.1, ClosePrice: 183.7, Volume: 140000 },
  { Timestamp: '2025-06-16T13:51:00Z', OpenPrice: 183.7, HighPrice: 184.2, LowPrice: 183.5, ClosePrice: 184, Volume: 145000 },
  { Timestamp: '2025-06-16T13:52:00Z', OpenPrice: 184, HighPrice: 184.5, LowPrice: 183.8, ClosePrice: 184.3, Volume: 135000 },
  { Timestamp: '2025-06-16T13:53:00Z', OpenPrice: 184.3, HighPrice: 184.9, LowPrice: 184.1, ClosePrice: 184.7, Volume: 140000 },
  { Timestamp: '2025-06-16T13:54:00Z', OpenPrice: 184.7, HighPrice: 185, LowPrice: 184.5, ClosePrice: 184.8, Volume: 140000 },
  { Timestamp: '2025-06-16T13:55:00Z', OpenPrice: 184.8, HighPrice: 185.2, LowPrice: 184.7, ClosePrice: 185, Volume: 130000 },
  { Timestamp: '2025-06-16T13:56:00Z', OpenPrice: 185, HighPrice: 185.6, LowPrice: 184.9, ClosePrice: 185.4, Volume: 130000 },
  { Timestamp: '2025-06-16T13:57:00Z', OpenPrice: 185.4, HighPrice: 186, LowPrice: 185.2, ClosePrice: 186.1, Volume: 130000 },
  { Timestamp: '2025-06-16T13:58:00Z', OpenPrice: 186.1, HighPrice: 188.7, LowPrice: 186.1, ClosePrice: 188.2, Volume: 130000 },
  { Timestamp: '2025-06-16T13:59:00Z', OpenPrice: 188.2, HighPrice: 188.5, LowPrice: 188, ClosePrice: 188.5, Volume: 130000 },
  { Timestamp: '2025-06-16T14:00:00Z', OpenPrice: 188.5, HighPrice: 189, LowPrice: 188, ClosePrice: 188.6, Volume: 120000 },
  { Timestamp: '2025-06-16T14:01:00Z', OpenPrice: 188.6, HighPrice: 188.8, LowPrice: 188.1, ClosePrice: 188.3, Volume: 120000 },
  { Timestamp: '2025-06-16T14:02:00Z', OpenPrice: 188.3, HighPrice: 188.7, LowPrice: 187.5, ClosePrice: 187.7, Volume: 120000 },
  { Timestamp: '2025-06-16T14:03:00Z', OpenPrice: 187.7, HighPrice: 188.2, LowPrice: 187.5, ClosePrice: 188, Volume: 120000 },
  { Timestamp: '2025-06-16T14:04:00Z', OpenPrice: 188, HighPrice: 188.5, LowPrice: 187.5, ClosePrice: 188.2, Volume: 120000 },
  { Timestamp: '2025-06-16T14:05:00Z', OpenPrice: 188.2, HighPrice: 188.7, LowPrice: 187.7, ClosePrice: 188.3, Volume: 110000 },
  { Timestamp: '2025-06-16T14:06:00Z', OpenPrice: 188.3, HighPrice: 188.5, LowPrice: 187.8, ClosePrice: 187.9, Volume: 110000 },
  { Timestamp: '2025-06-16T14:07:00Z', OpenPrice: 187.9, HighPrice: 188.2, LowPrice: 187.5, ClosePrice: 187.7, Volume: 110000 },
  { Timestamp: '2025-06-16T14:08:00Z', OpenPrice: 187.7, HighPrice: 188, LowPrice: 184.1, ClosePrice: 188.1, Volume: 110000 },
  { Timestamp: '2025-06-16T14:09:00Z', OpenPrice: 188.1, HighPrice: 188.5, LowPrice: 188, ClosePrice: 188.5, Volume: 110000 },
  // Additional 1-min bars for new 5-min bars
  { Timestamp: '2025-06-16T14:10:00Z', OpenPrice: 188.5, HighPrice: 189, LowPrice: 188.2, ClosePrice: 188.7, Volume: 100000 },
  { Timestamp: '2025-06-16T14:11:00Z', OpenPrice: 188.7, HighPrice: 189.2, LowPrice: 188.5, ClosePrice: 189, Volume: 95000 },
  { Timestamp: '2025-06-16T14:12:00Z', OpenPrice: 189, HighPrice: 189.5, LowPrice: 188.7, ClosePrice: 189.3, Volume: 90000 },
  { Timestamp: '2025-06-16T14:13:00Z', OpenPrice: 189.3, HighPrice: 189.7, LowPrice: 188.9, ClosePrice: 189.5, Volume: 95000 },
  { Timestamp: '2025-06-16T14:14:00Z', OpenPrice: 189.5, HighPrice: 189.5, LowPrice: 188.9, ClosePrice: 189.2, Volume: 90000 },
  { Timestamp: '2025-06-16T14:15:00Z', OpenPrice: 189.2, HighPrice: 189.8, LowPrice: 188.7, ClosePrice: 189.4, Volume: 95000 },
  { Timestamp: '2025-06-16T14:16:00Z', OpenPrice: 189.4, HighPrice: 190, LowPrice: 189.2, ClosePrice: 189.7, Volume: 95000 },
  { Timestamp: '2025-06-16T14:17:00Z', OpenPrice: 189.7, HighPrice: 190.2, LowPrice: 189.5, ClosePrice: 190, Volume: 90000 },
  { Timestamp: '2025-06-16T14:18:00Z', OpenPrice: 190, HighPrice: 190.5, LowPrice: 189.8, ClosePrice: 190.3, Volume: 95000 },
  { Timestamp: '2025-06-16T14:19:00Z', OpenPrice: 190.3, HighPrice: 191, LowPrice: 190, ClosePrice: 190.8, Volume: 95000 },
  { Timestamp: '2025-06-16T14:20:00Z', OpenPrice: 190.8, HighPrice: 191.2, LowPrice: 190.5, ClosePrice: 191, Volume: 90000 },
  { Timestamp: '2025-06-16T14:21:00Z', OpenPrice: 191, HighPrice: 191.5, LowPrice: 190.8, ClosePrice: 191.2, Volume: 90000 },
  { Timestamp: '2025-06-16T14:22:00Z', OpenPrice: 191.2, HighPrice: 191.5, LowPrice: 190.9, ClosePrice: 191.3, Volume: 90000 },
  { Timestamp: '2025-06-16T14:23:00Z', OpenPrice: 191.3, HighPrice: 191.5, LowPrice: 191, ClosePrice: 191.4, Volume: 90000 },
  { Timestamp: '2025-06-16T14:24:00Z', OpenPrice: 191.4, HighPrice: 191.5, LowPrice: 191.2, ClosePrice: 191.2, Volume: 90000 },
  { Timestamp: '2025-06-16T14:25:00Z', OpenPrice: 191.2, HighPrice: 191.8, LowPrice: 190.8, ClosePrice: 191.5, Volume: 90000 },
  { Timestamp: '2025-06-16T14:26:00Z', OpenPrice: 191.5, HighPrice: 192, LowPrice: 191.3, ClosePrice: 191.7, Volume: 90000 },
  { Timestamp: '2025-06-16T14:27:00Z', OpenPrice: 191.7, HighPrice: 192.2, LowPrice: 191.5, ClosePrice: 192, Volume: 90000 },
  { Timestamp: '2025-06-16T14:28:00Z', OpenPrice: 192, HighPrice: 192.5, LowPrice: 191.8, ClosePrice: 192.3, Volume: 90000 },
  { Timestamp: '2025-06-16T14:29:00Z', OpenPrice: 192.3, HighPrice: 192.5, LowPrice: 192, ClosePrice: 192.3, Volume: 90000 },
];

// SHORT
// const mock5MinBars = [
//   // ORB period (9:30–9:45)
//   { Timestamp: '2025-06-16T13:30:00Z', OpenPrice: 101, HighPrice: 102, LowPrice: 100.5, ClosePrice: 101.5, Volume: 300000 },
//   { Timestamp: '2025-06-16T13:35:00Z', OpenPrice: 101.5, HighPrice: 102.2, LowPrice: 100.7, ClosePrice: 101.8, Volume: 320000 },
//   { Timestamp: '2025-06-16T13:40:00Z', OpenPrice: 101.8, HighPrice: 102.1, LowPrice: 100.8, ClosePrice: 101.7, Volume: 310000 },
//   { Timestamp: '2025-06-16T13:45:00Z', OpenPrice: 101.7, HighPrice: 101.9, LowPrice: 100.6, ClosePrice: 101.6, Volume: 305000 },

//   // Post-ORB (breakdown below ORB low at 100.5)
//   { Timestamp: '2025-06-16T13:50:00Z', OpenPrice: 101.6, HighPrice: 101.7, LowPrice: 99.8, ClosePrice: 100.0, Volume: 600000 }, // <-- Confirmed short breakout
//   { Timestamp: '2025-06-16T13:55:00Z', OpenPrice: 100.0, HighPrice: 100.2, LowPrice: 99.7, ClosePrice: 99.8, Volume: 470000 },
//   { Timestamp: '2025-06-16T14:00:00Z', OpenPrice: 99.8, HighPrice: 100.1, LowPrice: 99.5, ClosePrice: 99.6, Volume: 460000 },
//   { Timestamp: '2025-06-16T14:05:00Z', OpenPrice: 99.6, HighPrice: 99.9, LowPrice: 99.3, ClosePrice: 99.3, Volume: 450000 },
//   { Timestamp: '2025-06-16T14:10:00Z', OpenPrice: 99.3, HighPrice: 99.7, LowPrice: 98.9, ClosePrice: 99.0, Volume: 440000 },
//   { Timestamp: '2025-06-16T14:15:00Z', OpenPrice: 99.0, HighPrice: 99.2, LowPrice: 98.7, ClosePrice: 98.8, Volume: 430000 },
//   { Timestamp: '2025-06-16T14:20:00Z', OpenPrice: 98.8, HighPrice: 99.0, LowPrice: 98.5, ClosePrice: 98.6, Volume: 420000 },
//   { Timestamp: '2025-06-16T14:25:00Z', OpenPrice: 98.6, HighPrice: 98.9, LowPrice: 98.3, ClosePrice: 98.4, Volume: 410000 },
//   { Timestamp: '2025-06-16T14:30:00Z', OpenPrice: 98.4, HighPrice: 98.7, LowPrice: 98.1, ClosePrice: 98.2, Volume: 400000 },
//   { Timestamp: '2025-06-16T14:35:00Z', OpenPrice: 98.2, HighPrice: 98.5, LowPrice: 98.0, ClosePrice: 98.0, Volume: 390000 },
// ];

// const mock1MinBars = [
//   // ORB period (first 4×5 = 20 min, 9:30–9:50)
//   { Timestamp: '2025-06-16T13:30:00Z', OpenPrice: 101, HighPrice: 101.5, LowPrice: 100.8, ClosePrice: 101.2, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:31:00Z', OpenPrice: 101.2, HighPrice: 101.6, LowPrice: 100.9, ClosePrice: 101.4, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:32:00Z', OpenPrice: 101.4, HighPrice: 101.7, LowPrice: 101.0, ClosePrice: 101.5, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:33:00Z', OpenPrice: 101.5, HighPrice: 101.8, LowPrice: 101.1, ClosePrice: 101.6, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:34:00Z', OpenPrice: 101.6, HighPrice: 101.9, LowPrice: 101.2, ClosePrice: 101.7, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:35:00Z', OpenPrice: 101.7, HighPrice: 102.0, LowPrice: 101.3, ClosePrice: 101.8, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:36:00Z', OpenPrice: 101.8, HighPrice: 102.1, LowPrice: 101.4, ClosePrice: 101.7, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:37:00Z', OpenPrice: 101.7, HighPrice: 102.0, LowPrice: 101.3, ClosePrice: 101.6, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:38:00Z', OpenPrice: 101.6, HighPrice: 101.9, LowPrice: 101.2, ClosePrice: 101.5, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:39:00Z', OpenPrice: 101.5, HighPrice: 101.8, LowPrice: 101.1, ClosePrice: 101.4, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:40:00Z', OpenPrice: 101.4, HighPrice: 101.7, LowPrice: 101.0, ClosePrice: 101.3, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:41:00Z', OpenPrice: 101.3, HighPrice: 101.6, LowPrice: 100.9, ClosePrice: 101.2, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:42:00Z', OpenPrice: 101.2, HighPrice: 101.5, LowPrice: 100.8, ClosePrice: 101.1, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:43:00Z', OpenPrice: 101.1, HighPrice: 101.4, LowPrice: 100.7, ClosePrice: 101.0, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:44:00Z', OpenPrice: 101.0, HighPrice: 101.3, LowPrice: 100.6, ClosePrice: 100.9, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:45:00Z', OpenPrice: 100.9, HighPrice: 101.2, LowPrice: 100.5, ClosePrice: 100.8, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:46:00Z', OpenPrice: 100.8, HighPrice: 101.0, LowPrice: 100.4, ClosePrice: 100.7, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:47:00Z', OpenPrice: 100.7, HighPrice: 100.9, LowPrice: 100.3, ClosePrice: 100.6, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:48:00Z', OpenPrice: 100.6, HighPrice: 100.8, LowPrice: 100.2, ClosePrice: 100.5, Volume: 60000 },
//   { Timestamp: '2025-06-16T13:49:00Z', OpenPrice: 100.5, HighPrice: 100.7, LowPrice: 99.8, ClosePrice: 100.0, Volume: 70000 },

//   // Breakdown (short breakout) and retest
//   { Timestamp: '2025-06-16T13:50:00Z', OpenPrice: 100.0, HighPrice: 100.2, LowPrice: 99.6, ClosePrice: 99.8, Volume: 120000 }, // breakdown
//   { Timestamp: '2025-06-16T13:51:00Z', OpenPrice: 99.8, HighPrice: 100.5, LowPrice: 99.7, ClosePrice: 100.4, Volume: 110000 }, // retest up to ORB low
//   { Timestamp: '2025-06-16T13:52:00Z', OpenPrice: 100.4, HighPrice: 100.6, LowPrice: 99.5, ClosePrice: 99.7, Volume: 110000 }, // rejection
//   { Timestamp: '2025-06-16T13:53:00Z', OpenPrice: 99.7, HighPrice: 99.9, LowPrice: 99.2, ClosePrice: 99.5, Volume: 90000 },
//   { Timestamp: '2025-06-16T13:54:00Z', OpenPrice: 99.5, HighPrice: 99.7, LowPrice: 99.0, ClosePrice: 99.2, Volume: 90000 },
//   { Timestamp: '2025-06-16T13:55:00Z', OpenPrice: 99.2, HighPrice: 99.4, LowPrice: 98.8, ClosePrice: 99.0, Volume: 90000 },
// ];
module.exports = { mock5MinBars, mock1MinBars };