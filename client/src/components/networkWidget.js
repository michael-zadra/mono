import React from 'react';
import _ from 'lodash';
import { croppedAddress, displayNumber } from '../utils';
import { CONFIRMATION_THRESHOLD } from '../ethereum/utils';
import useCloseOnClickOrEsc from '../hooks/useCloseOnClickOrEsc';
import NetworkErrors from './networkErrors';
import { iconCheck } from './icons.js';

function NetworkWidget(props) {
  const [node, showNetworkWidgetInfo, setShowNetworkWidgetInfo] = useCloseOnClickOrEsc();

  function enableMetamask() {
    if (props.user.address) {
      return;
    }
    window.ethereum
      .request({ method: 'eth_requestAccounts' })
      .then(_result => {
        props.connectionComplete();
      })
      .catch(error => {
        console.error('Error connecting to metamask', error);
      });
  }

  function disableMetamask() {
    // TODO: Implement this!
    props.setUser(false);
    setShowNetworkWidgetInfo('');
  }

  function toggleOpenWidget() {
    if (showNetworkWidgetInfo === '') {
      setShowNetworkWidgetInfo('open');
    } else {
      setShowNetworkWidgetInfo('');
    }
  }

  let transactions = '';
  let enabledText = croppedAddress(props.user.address);
  let enabledClass = '';

  function transactionItem(tx) {
    const transactionlabel = tx.type === 'Approval' ? tx.type : `$${tx.amount} ${tx.type}`;
    let etherscanSubdomain;
    if (props.network === 'mainnet') {
      etherscanSubdomain = '';
    } else {
      etherscanSubdomain = `${props.network}.`;
    }
    return (
      <div key={tx.id} className={`transaction-item ${tx.status}`}>
        <div className="status-icon">
          <div className="indicator"></div>
          <div className="spinner">
            <div className="double-bounce1"></div>
            <div className="double-bounce2"></div>
          </div>
        </div>
        {transactionlabel}&nbsp;
        <a href={`https://${etherscanSubdomain}etherscan.io/tx/${tx.id}`} target="_blank" rel="noopener noreferrer">
          &#8599;
        </a>
        {tx.status === 'pending' && `${tx.confirmations} / ${CONFIRMATION_THRESHOLD} confirmations`}
      </div>
    );
  }

  if (props.currentErrors.length > 0) {
    enabledClass = 'error';
    enabledText = 'Error';
  } else if (_.some(props.currentTXs, { status: 'pending' })) {
    const pendingTXCount = _.countBy(props.currentTXs, { status: 'pending' }).true;
    const confirmingCount = _.countBy(props.currentTXs, item => {
      return item.status === 'pending' && item.confirmations > 0;
    }).true;
    enabledClass = 'pending';
    if (confirmingCount > 0) {
      enabledText = 'Confirming';
    } else if (pendingTXCount > 0) {
      enabledText = pendingTXCount === 1 ? 'Processing' : pendingTXCount + ' Processing';
    }
  } else if (props.currentTXs.length > 0 && _.every(props.currentTXs, { status: 'successful' })) {
    enabledClass = 'success';
  }

  let allTx = _.compact(_.concat(props.currentTXs, _.slice(props.user.pastTxs, 0, 5)));
  allTx = _.uniqBy(allTx, 'id');
  if (allTx.length > 0) {
    transactions = (
      <div className="network-widget-section">
        <div className="network-widget-header">
          Transactions
          {/* <a href="/transactions">view all</a> */}
        </div>
        {allTx.map(transactionItem)}
      </div>
    );
  }

  const disabledNetworkWidget = (
    <div ref={node} className="network-widget">
      <button className="network-widget-button bold" onClick={enableMetamask}>
        Connect Metamask
      </button>
    </div>
  );

  const enabledNetworkWidget = (
    <div ref={node} className={`network-widget ${showNetworkWidgetInfo}`}>
      <button className={`network-widget-button ${enabledClass}`} onClick={toggleOpenWidget}>
        <div className="status-icon">
          <div className="indicator"></div>
          <div className="spinner">
            <div className="double-bounce1"></div>
            <div className="double-bounce2"></div>
          </div>
        </div>
        {enabledText}
        <div className="success-indicator">{iconCheck}Success</div>
      </button>
      <div className="network-widget-info">
        <div className="network-widget-section address">{croppedAddress(props.user.address)}</div>
        <NetworkErrors currentErrors={props.currentErrors} />
        <div className="network-widget-section">
          USDC balance <span className="value">{displayNumber(props.user.usdcBalance, 2)}</span>
        </div>
        {transactions}
        <div className="network-widget-section">
          <button className="network-widget-disable-button" onClick={disableMetamask}>
            Disconnect Metamask
          </button>
        </div>
      </div>
    </div>
  );

  if (!props.user.address) {
    return disabledNetworkWidget;
  } else {
    return enabledNetworkWidget;
  }
}

export default NetworkWidget;
