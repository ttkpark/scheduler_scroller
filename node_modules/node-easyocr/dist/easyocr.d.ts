interface OCRResult {
    bbox: number[][];
    text: string;
    confidence: number;
}
export declare class EasyOCR {
    private pythonPath;
    private scriptPath;
    private pythonProcess;
    constructor();
    private startPythonProcess;
    private sendCommand;
    init(languages?: string[]): Promise<void>;
    readText(imagePath: string): Promise<OCRResult[]>;
    close(): Promise<void>;
}
export default EasyOCR;
//# sourceMappingURL=easyocr.d.ts.map