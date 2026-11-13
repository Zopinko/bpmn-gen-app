import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import WorkforceOverlay from "./WorkforceOverlay";
import "./WorkforceCoverage.css";

const RISK_ORDER = ["unassigned", "critical", "low", "none"];
const LEVELS = ["primary", "backup", "training"];

function stepKey({ process_node_id, step_id }) {
  return JSON.stringify([process_node_id, step_id]);
}

function searchText(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function AssignmentDialog({ orgId, row, onClose, onChanged }) {
  const dialog = useRef(null);

  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="workforce-assignment-dialog" aria-label={row.step_name} onClose={onClose}>
      <WorkforceOverlay
        orgId={orgId}
        processNodeId={row.process_node_id}
        selectedStepId={row.step_id}
        stepName={row.step_name}
        processName={row.process_name}
        startAdding={row.risk !== "none"}
        initialLevel={row.people.primary.length ? "backup" : "primary"}
        onClose={() => dialog.current.close()}
        onChanged={onChanged}
      />
    </dialog>
  );
}

export default function WorkforceCoverage({ matrix, orgId, onChanged }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [processId, setProcessId] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [editing, setEditing] = useState(null);

  const { rows, processes } = useMemo(() => {
    const employees = new Map(matrix.employees.map((employee) => [employee.id, employee]));
    const risks = new Map(matrix.risk.map((risk) => [stepKey(risk), risk.risk]));
    const processNames = new Map();
    const rowsByKey = new Map();
    for (const step of matrix.steps) {
      const key = stepKey(step);
      processNames.set(step.process_node_id, step.process_name);
      rowsByKey.set(key, { ...step, key, risk: risks.get(key) || "unassigned", people: { primary: [], backup: [], training: [] } });
    }
    for (const cell of matrix.cells) {
      const employee = employees.get(cell.emp_id);
      if (employee) rowsByKey.get(stepKey(cell))?.people[cell.level]?.push(employee);
    }
    return {
      rows: [...rowsByKey.values()].sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk)),
      processes: [...processNames].sort(([, a], [, b]) => a.localeCompare(b)),
    };
  }, [matrix]);

  const search = searchText(query.trim());
  const matchingRows = rows.filter((row) => {
    if (processId && row.process_node_id !== processId) return false;
    if (!search) return true;
    const names = LEVELS.flatMap((level) => row.people[level].map(({ name, emp_no }) => `${name} ${emp_no}`));
    return searchText([row.step_name, row.process_name, ...names].join(" ")).includes(search);
  });
  const counts = { unassigned: 0, critical: 0, low: 0, none: 0 };
  for (const row of matchingRows) counts[row.risk] += 1;
  const visibleRows = riskFilter ? matchingRows.filter((row) => row.risk === riskFilter) : matchingRows;

  const clearFilters = () => {
    setQuery("");
    setProcessId("");
    setRiskFilter("");
  };

  return (
    <section className="workforce-coverage" aria-labelledby="workforce-coverage-title">
      <header className="workforce-coverage__intro">
        <h2 id="workforce-coverage-title">{t("workforce.simple_table_title")}</h2>
        <p>{t("workforce.coverage_hint")}</p>
      </header>

      {rows.length ? (
        <>
          <div className="workforce-coverage__filters">
            <label className="wizard-field">
              <span>{t("workforce.coverage_search")}</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("workforce.coverage_search_placeholder")} />
            </label>
            <label className="wizard-field">
              <span>{t("workforce.filter_process")}</span>
              <select aria-label={t("workforce.filter_process")} value={processId} onChange={(event) => setProcessId(event.target.value)}>
                <option value="">{t("workforce.filter_all_processes")}</option>
                {processes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="workforce-coverage__statuses" role="group" aria-label={t("workforce.col_risk")}>
            {["", ...RISK_ORDER].map((risk) => (
              <button key={risk} type="button" aria-pressed={risk === riskFilter} onClick={() => setRiskFilter(risk)}>
                {risk ? <span className={`workforce-coverage__dot is-${risk}`} /> : null}
                {t(risk ? `workforce.coverage_${risk}` : "workforce.coverage_all")}
                <strong>{risk ? counts[risk] : matchingRows.length}</strong>
              </button>
            ))}
          </div>
          <div className="workforce-coverage__results">
            <span role="status">{t("workforce.coverage_results", { shown: visibleRows.length, total: rows.length })}</span>
            {query || processId || riskFilter ? <button type="button" className="btn btn--small" onClick={clearFilters}>{t("workforce.clear_filters")}</button> : null}
          </div>
          {visibleRows.length ? (
            <div className="workforce-coverage__table-wrap">
              <table className="workforce-coverage__table" aria-labelledby="workforce-coverage-title" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">{t("workforce.col_process_step")}</th>
                    <th scope="col" role="columnheader">{t("workforce.col_risk")}</th>
                    {LEVELS.map((level) => <th key={level} scope="col" role="columnheader">{t(`workforce.col_${level}`)}</th>)}
                    <th scope="col" role="columnheader">{t("workforce.col_actions")}</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {visibleRows.map((row) => (
                    <tr key={row.key} role="row">
                      <th scope="row" role="rowheader" className="workforce-coverage__step">
                        <strong>{row.step_name}</strong>
                        <span>{row.process_name}</span>
                      </th>
                      <td role="cell" className="workforce-coverage__risk">
                        <span className={`workforce-risk-badge is-${row.risk}`}>
                          {t(`workforce.coverage_${row.risk}`)}
                        </span>
                      </td>
                      {LEVELS.map((level) => (
                        <td key={level} role="cell" className="workforce-coverage__people">
                          <span className="workforce-coverage__mobile-label" aria-hidden="true">{t(`workforce.col_${level}`)}</span>
                          {row.people[level].length ? (
                            <ul>{row.people[level].map((person) => <li key={person.id}>{person.name}</li>)}</ul>
                          ) : <span className="workforce-coverage__vacant">{t(level === "training" ? "workforce.coverage_no_training" : "workforce.coverage_missing")}</span>}
                        </td>
                      ))}
                      <td role="cell" className="workforce-coverage__action">
                        <button type="button" className="btn btn--small" onClick={() => setEditing(row)}>
                          {t(row.risk === "none" ? "workforce.manage_assignments" : "workforce.add_assignment")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="workforce-empty-state">
              <h3>{t("workforce.matrix_no_results_title")}</h3>
              <p>{t("workforce.coverage_no_results")}</p>
            </div>
          )}
        </>
      ) : (
        <div className="workforce-empty-state">
          <h3>{t("workforce.coverage_empty_title")}</h3>
          <p>{t("workforce.coverage_empty_hint")}</p>
          <Link to="/" className="btn btn--small">{t("workforce.back_to_map")}</Link>
        </div>
      )}

      {editing ? <AssignmentDialog orgId={orgId} row={editing} onClose={() => setEditing(null)} onChanged={onChanged} /> : null}
    </section>
  );
}
