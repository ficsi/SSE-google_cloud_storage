import React from "react";

const Ledger = ({ totals }) => {
  return (
    <div className="row" style={{ marginBottom: 12 }}>
  <div className="col-md-3 col-sm-6 col-12">
    <div className="info-box">
      <span className="info-box-icon bg-success"><i className="fas fa-wallet" /></span>
      <div className="info-box-content">
        <span className="info-box-text">UPI Received</span>
        <span className="info-box-number">{totals.upi.toLocaleString()}</span>
      </div>
    </div>
  </div>

  <div className="col-md-3 col-sm-6 col-12">
    <div className="info-box">
      <span className="info-box-icon bg-primary"><i className="fas fa-university" /></span>
      <div className="info-box-content">
        <span className="info-box-text">Bank Received</span>
        <span className="info-box-number">{totals.bank.toLocaleString()}</span>
      </div>
    </div>
  </div>

  <div className="col-md-3 col-sm-6 col-12">
    <div className="info-box">
      <span className="info-box-icon bg-info"><i className="fas fa-coins" /></span>
      <div className="info-box-content">
        <span className="info-box-text">Total Received</span>
        <span className="info-box-number">{totals.total.toLocaleString()}</span>
      </div>
    </div>
  </div>

  <div className="col-md-3 col-sm-6 col-12">
    <div className="info-box">
      <span className="info-box-icon bg-warning"><i className="fas fa-clock" /></span>
      <div className="info-box-content">
        <span className="info-box-text">Pending</span>
        <span className="info-box-number">{totals.pending.toLocaleString()}</span>
      </div>
    </div>
  </div>
</div>

  );
};

export default Ledger;
