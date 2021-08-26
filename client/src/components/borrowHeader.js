import React, {useState, useEffect, useContext} from "react"
import {fetchCreditLineData} from "../ethereum/creditLine"
import {usdcFromAtomic} from "../ethereum/erc20"
import {displayDollars} from "../utils"
import Dropdown from "./dropdown"
import {AppContext} from "../App"

function BorrowHeader(props) {
  const {goldfinchProtocol} = useContext(AppContext)
  const [creditLinePreviews, setCreditLinePreviews] = useState([])

  useEffect(() => {
    async function getCreditLinePreviews() {
      let creditLines = []
      if (props.creditLinesAddresses.length > 1) {
        const multipleCreditLines = await fetchCreditLineData(props.creditLinesAddresses, goldfinchProtocol)
        if (multipleCreditLines.creditLines.length > 1) {
          // If there are multiple credit lines, we nee dto show the Multiple creditlines first (the "All" option), and
          // then each of the individual credit lines
          creditLines = [multipleCreditLines, ...multipleCreditLines.creditLines]
        } else {
          // In some cases multiple credit lines can only have a single active creditline (e.g. an old creditline
          // that has a 0 limit). In this case, treat it as a single credit line.
          creditLines = multipleCreditLines.creditLines
        }
      } else {
        creditLines = [await fetchCreditLineData(props.creditLinesAddresses, goldfinchProtocol)]
      }
      setCreditLinePreviews(creditLines)
    }
    getCreditLinePreviews()
  }, [goldfinchProtocol, props.creditLinesAddresses])

  if (props.creditLinesAddresses.length > 1) {
    const options = creditLinePreviews.map((cl) => {
      return {
        value: cl.address,
        selectedEl: <>{cl.name}</>,
        el: (
          <>
            {cl.name}
            <span className="dropdown-amount">{displayDollars(usdcFromAtomic(cl.limit))}</span>
          </>
        ),
      }
    })

    return (
      <div>
        <span>Credit Line /</span>
        <Dropdown
          selected={props.selectedCreditLine.address}
          options={options}
          onSelect={(address) => {
            props.changeCreditLine(address)
          }}
        />
      </div>
    )
  }

  let header = "Loading..."
  if (props.user.loaded && props.selectedCreditLine.address) {
    header = `Credit Line / ${props.selectedCreditLine.name}`
  } else if (props.user.loaded) {
    header = "Credit Line"
  }
  return header
}

export default BorrowHeader
