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
    expect(statusScreen).toContain('Challenge this outcome');
    expect(statusScreen).toContain('report.appeal');
    expect(statusScreen).toContain('We share only information appropriate to your report');
    expect(statusScreen).toContain('Reports are not an emergency service');
  });

  it('reports reviews by review ID without accepting customer identity', () => {
    expect(reviewsScreen).toContain('useCreateReport');
    expect(reviewsScreen).toContain('reviewId');
    expect(reviewsScreen).toContain("reportedRole: 'customer'");
    expect(reviewsScreen).not.toContain('customerId');
    expect(reviewsScreen).toContain("option.value.toUpperCase() !== 'CSEA'");
  });
});