import * as fs from 'fs';
import * as path from 'path';

const mobileRoot = path.resolve(__dirname, '../..');
const conversationScreen = fs.readFileSync(
  path.join(mobileRoot, 'app/(tabs)/messages/[id].tsx'),
  'utf8',
);
const statusScreen = fs.readFileSync(
  path.join(mobileRoot, 'app/(tabs)/report-status.tsx'),
  'utf8',
);
const reviewsScreen = fs.readFileSync(
  path.join(mobileRoot, 'app/(tabs)/trader-dashboard/reviews.tsx'),
  'utf8',
);

describe('mobile reporting readiness regressions', () => {
  it('reports an individual message with conversation and message IDs and server category', () => {
    expect(conversationScreen).toContain('useReportConversationMessage');
    expect(conversationScreen).toContain('{ id: conversationId, messageId, data: { category: option.value, reason: trimmed }');
    expect(conversationScreen).toContain('onLongPress={() => onReportMessage(item.id)}');
    expect(conversationScreen).toContain('onPress={() => onReportMessage(item.id)}');
  });

  it('does not expose CSEA as a selectable public category', () => {
    expect(conversationScreen).toContain('SUSPECTED_ILLEGAL_CONTENT');
    expect(conversationScreen).not.toContain('CSEA');
  });

  it('keeps report outcomes safe and offers a linked challenge form', () => {
    expect(statusScreen).toContain('useAppealReport');
    expect(statusScreen).toContain('useAppealConversationReport');
    expect(statusScreen).toContain('Appeal this outcome');
    expect(statusScreen).toContain('report.appeal');
    expect(statusScreen).toContain('We share only information appropriate to your report');
    expect(statusScreen).toContain('Reports are not an emergency service');
  });

  it('limits appeals to 30 days and preserves existing appeal status', () => {
    expect(statusScreen).toContain('APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000');
    expect(statusScreen).toContain('Appeal available until');
    expect(statusScreen).toContain('Appeal period ended');
    expect(statusScreen).toContain('report.appeal ?');
    expect(statusScreen).toContain('Date.now() <= deadline.getTime()');
  });

  it('explains appeals are separate from decisions and safety handling', () => {
    expect(statusScreen).toContain('separate review');
    expect(statusScreen).toContain('does not automatically reverse');
    expect(statusScreen).toContain('Safety handling may continue independently');
  });

  it('keeps complaint response timing distinct from report appeals', () => {
    const complaintsScreen = fs.readFileSync(
      path.join(mobileRoot, 'app/(tabs)/complaints.tsx'),
      'utf8',
    );
    expect(complaintsScreen).toContain('complaint response timing is separate');
    expect(complaintsScreen).toContain('30-day appeal period');
    expect(complaintsScreen).not.toContain('CSEA');
    expect(complaintsScreen).not.toContain('internal');
  });

  it('refreshes report and appeal outcomes on navigation focus and app return', () => {
    expect(statusScreen).toContain('useFocusEffect');
    expect(statusScreen).toContain('void refetch()');
    expect(statusScreen).toContain("AppState.addEventListener('change'");
    expect(statusScreen).toContain("state === 'active' && isFocusedRef.current && isAuthenticated");
    expect(statusScreen).toContain('getGetMyReportsQueryKey()');
  });

  it('reports reviews by review ID without accepting customer identity', () => {
    expect(reviewsScreen).toContain('useCreateReport');
    expect(reviewsScreen).toContain('reviewId');
    expect(reviewsScreen).toContain("reportedRole: 'customer'");
    expect(reviewsScreen).not.toContain('customerId');
    expect(reviewsScreen).toContain("option.value.toUpperCase() !== 'CSEA'");
  });
});