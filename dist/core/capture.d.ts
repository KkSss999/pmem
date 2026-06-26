export interface CaptureOptions {
    auto?: boolean;
    summary?: string;
    next?: string;
    full?: boolean;
    force?: boolean;
}
export interface CaptureResult {
    success: boolean;
    message: string;
    tracePath?: string;
    skipped?: boolean;
}
export declare function captureCore(pmemPath: string, options?: CaptureOptions): CaptureResult;
//# sourceMappingURL=capture.d.ts.map