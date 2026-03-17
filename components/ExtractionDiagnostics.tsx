import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, FileText, Download } from 'lucide-react';
import { PDFDiagnostics } from '../types';

interface ExtractionDiagnosticsProps {
  diagnostics: PDFDiagnostics | null;
}

const ExtractionDiagnostics: React.FC<ExtractionDiagnosticsProps> = ({ diagnostics }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<{
    rejectedAsins: boolean;
    quantityDefaults: boolean;
    pageClassifications: boolean;
  }>({
    rejectedAsins: false,
    quantityDefaults: false,
    pageClassifications: false
  });

  if (!diagnostics) {
    return null;
  }

  const { summary, rejectedAsins, quantityDefaults, pageClassifications } = diagnostics;
  const hasIssues = rejectedAsins.length > 0 || quantityDefaults.length > 0;

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const exportDiagnostics = () => {
    const dataStr = JSON.stringify(diagnostics, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `extraction-diagnostics-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-6 border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div
        className={`flex items-center justify-between p-4 cursor-pointer ${
          hasIssues ? 'bg-yellow-50 border-b border-yellow-200' : 'bg-gray-50'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          {hasIssues ? (
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
          ) : (
            <CheckCircle className="h-5 w-5 text-green-600" />
          )}
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Extraction Diagnostics
              {hasIssues && (
                <span className="ml-2 text-sm font-normal text-yellow-700">
                  ({rejectedAsins.length} rejected, {quantityDefaults.length} qty defaults)
                </span>
              )}
            </h3>
            <p className="text-sm text-gray-600">
              {summary.totalAsinsAccepted} ASINs accepted, {summary.extractedQty} total qty extracted
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              exportDiagnostics();
            }}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Export diagnostics as JSON"
          >
            <Download className="h-4 w-4" />
          </button>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-600" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-600" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="text-sm text-blue-600 font-medium">ASINs Attempted</p>
              <p className="text-2xl font-bold text-blue-900">{summary.totalAsinsAttempted}</p>
            </div>
            <div className="bg-green-50 p-3 rounded-lg">
              <p className="text-sm text-green-600 font-medium">ASINs Accepted</p>
              <p className="text-2xl font-bold text-green-900">{summary.totalAsinsAccepted}</p>
            </div>
            <div className="bg-red-50 p-3 rounded-lg">
              <p className="text-sm text-red-600 font-medium">ASINs Rejected</p>
              <p className="text-2xl font-bold text-red-900">{summary.totalAsinsRejected}</p>
            </div>
            <div className="bg-yellow-50 p-3 rounded-lg">
              <p className="text-sm text-yellow-600 font-medium">Qty Defaults</p>
              <p className="text-2xl font-bold text-yellow-900">{summary.totalQtyDefaults}</p>
            </div>
          </div>

          {/* Rejected ASINs Section */}
          {rejectedAsins.length > 0 && (
            <div className="border border-red-200 rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between p-3 bg-red-50 cursor-pointer"
                onClick={() => toggleSection('rejectedAsins')}
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <h4 className="font-semibold text-red-900">
                    Rejected ASINs ({rejectedAsins.length})
                  </h4>
                </div>
                {expandedSections.rejectedAsins ? (
                  <ChevronUp className="h-4 w-4 text-red-600" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-red-600" />
                )}
              </div>
              {expandedSections.rejectedAsins && (
                <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
                  {rejectedAsins.map((item, idx) => (
                    <div key={idx} className="bg-white border border-red-100 rounded p-3 text-sm">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-mono text-red-700 font-semibold">{item.asin}</p>
                          <p className="text-gray-600 mt-1">
                            <span className="font-medium">Reason:</span> {item.reason}
                          </p>
                          <p className="text-gray-600">
                            <span className="font-medium">Location:</span> {item.fileName}, Page {item.pageNumber}, Line {item.lineIndex}
                          </p>
                          <p className="text-gray-600">
                            <span className="font-medium">Score:</span> {item.score}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 bg-gray-50 p-2 rounded text-xs">
                        <p className="font-medium text-gray-700">Line:</p>
                        <p className="text-gray-600 font-mono break-all">{item.lineContent.substring(0, 200)}</p>
                      </div>
                      {item.contextLines.length > 0 && (
                        <div className="mt-2 bg-gray-50 p-2 rounded text-xs">
                          <p className="font-medium text-gray-700">Context (±3 lines):</p>
                          {item.contextLines.map((line, i) => (
                            <p key={i} className="text-gray-600 font-mono break-all">
                              {line.substring(0, 150)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quantity Defaults Section */}
          {quantityDefaults.length > 0 && (
            <div className="border border-yellow-200 rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between p-3 bg-yellow-50 cursor-pointer"
                onClick={() => toggleSection('quantityDefaults')}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <h4 className="font-semibold text-yellow-900">
                    Quantity Defaults (qty=1) ({quantityDefaults.length})
                  </h4>
                </div>
                {expandedSections.quantityDefaults ? (
                  <ChevronUp className="h-4 w-4 text-yellow-600" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-yellow-600" />
                )}
              </div>
              {expandedSections.quantityDefaults && (
                <div className="p-3 space-y-2 max-h-96 overflow-y-auto">
                  {quantityDefaults.map((item, idx) => (
                    <div key={idx} className="bg-white border border-yellow-100 rounded p-3 text-sm">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-mono text-yellow-700 font-semibold">{item.asin}</p>
                          <p className="text-gray-600 mt-1">
                            <span className="font-medium">Location:</span> {item.fileName}, Page {item.pageNumber}, Line {item.lineIndex}
                          </p>
                          <p className="text-gray-600">
                            <span className="font-medium">Patterns attempted:</span> {item.patternsAttempted.length}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 bg-gray-50 p-2 rounded text-xs">
                        <p className="font-medium text-gray-700">Line:</p>
                        <p className="text-gray-600 font-mono break-all">{item.lineContent.substring(0, 200)}</p>
                      </div>
                      <div className="mt-2 bg-gray-50 p-2 rounded text-xs">
                        <p className="font-medium text-gray-700">Search window (6 lines):</p>
                        {item.searchWindowLines.map((line, i) => (
                          <p key={i} className="text-gray-600 font-mono break-all">
                            {line.substring(0, 150)}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Page Classifications Section */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer"
              onClick={() => toggleSection('pageClassifications')}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-600" />
                <h4 className="font-semibold text-gray-900">
                  Page Classifications ({pageClassifications.length})
                </h4>
              </div>
              {expandedSections.pageClassifications ? (
                <ChevronUp className="h-4 w-4 text-gray-600" />
              ) : (
                <ChevronDown className="h-4 w-4 text-gray-600" />
              )}
            </div>
            {expandedSections.pageClassifications && (
              <div className="p-3">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">File</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Page</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Type</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Page #</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-700">Continuation</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-700">Description</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-700">TOTAL</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">ASINs Found</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Accepted</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Rejected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {pageClassifications.map((page, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-900 font-mono text-xs">{page.fileName}</td>
                          <td className="px-3 py-2 text-gray-900">{page.pageNumber}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                page.pageType === 'invoice'
                                  ? 'bg-blue-100 text-blue-700'
                                  : page.pageType === 'shipping'
                                  ? 'bg-purple-100 text-purple-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {page.pageType}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600 text-xs font-mono">
                            {page.pageNumbering || '-'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {page.isContinuation ? (
                              <span className="text-green-600">✓</span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {page.hasDescription ? (
                              <span className="text-green-600">✓</span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {page.hasTOTAL ? (
                              <span className="text-green-600">✓</span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-900">{page.asinsFound}</td>
                          <td className="px-3 py-2 text-right text-green-700 font-medium">{page.asinsAccepted}</td>
                          <td className="px-3 py-2 text-right text-red-700 font-medium">{page.asinsRejected}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Help Text */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
            <p className="font-semibold text-blue-900 mb-2">Understanding Diagnostics:</p>
            <ul className="list-disc list-inside space-y-1 text-blue-800">
              <li><strong>Rejected ASINs:</strong> ASINs found but not included (usually in address sections)</li>
              <li><strong>Quantity Defaults:</strong> ASINs where quantity couldn't be extracted and defaulted to 1 (may indicate missing quantities)</li>
              <li><strong>Page Classifications:</strong> How each PDF page was classified (invoice, shipping, or unknown)</li>
              <li><strong>Continuation:</strong> Pages that continue a multi-page invoice</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExtractionDiagnostics;
